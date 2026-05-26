// v42-mcp -- Model Context Protocol server for the V42 project management platform.
//
// Communicates over stdio (stdin -> stdout) using JSON-RPC 2.0 + MCP protocol.
// Logs diagnostics to stderr so stdout stays clean for the protocol.
//
// Configuration (env vars):
//
//	V42_API_URL   -- V42 base URL, default: http://localhost:8080/api/v1
//	V42_API_TOKEN -- JWT access token (required)
//
// Usage with Claude Desktop:
//
//	{
//	  "mcpServers": {
//	    "v42": {
//	      "command": "/path/to/v42-mcp",
//	      "env": { "V42_API_TOKEN": "eyJ..." }
//	    }
//	  }
//	}
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 wire types
// ---------------------------------------------------------------------------

type rpcRequest struct {
	JSONRPC string           `json:"jsonrpc"`
	ID      *json.RawMessage `json:"id,omitempty"`
	Method  string           `json:"method"`
	Params  json.RawMessage  `json:"params,omitempty"`
}

type rpcResponse struct {
	JSONRPC string           `json:"jsonrpc"`
	ID      *json.RawMessage `json:"id,omitempty"`
	Result  any              `json:"result,omitempty"`
	Error   *rpcError        `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// ---------------------------------------------------------------------------
// MCP protocol types
// ---------------------------------------------------------------------------

type mcpInitResult struct {
	ProtocolVersion string `json:"protocolVersion"`
	Capabilities    struct {
		Tools *struct{} `json:"tools,omitempty"`
	} `json:"capabilities"`
	ServerInfo struct {
		Name    string `json:"name"`
		Version string `json:"version"`
	} `json:"serverInfo"`
}

type mcpTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
}

type mcpContent struct {
	Type string `json:"type"` // always "text"
	Text string `json:"text"`
}

type mcpCallResult struct {
	Content []mcpContent `json:"content"`
	IsError bool         `json:"isError,omitempty"`
}

// ---------------------------------------------------------------------------
// V42 HTTP client
// ---------------------------------------------------------------------------

type client struct {
	base string
	tok  string
	http *http.Client
}

func newClient(base, tok string) *client {
	return &client{
		base: strings.TrimRight(base, "/"),
		tok:  tok,
		http: &http.Client{Timeout: 15 * time.Second},
	}
}

// get fetches a V42 API path and unwraps the { data, error } envelope.
func (c *client) get(ctx context.Context, path string) (json.RawMessage, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.tok)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	return unwrap(resp)
}

// patch sends a PATCH request and unwraps the envelope.
func (c *client) patch(ctx context.Context, path string, body any) (json.RawMessage, error) {
	return c.send(ctx, http.MethodPatch, path, body)
}

// post sends a POST request and unwraps the envelope.
func (c *client) post(ctx context.Context, path string, body any) (json.RawMessage, error) {
	return c.send(ctx, http.MethodPost, path, body)
}

func (c *client) send(ctx context.Context, method, path string, body any) (json.RawMessage, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.tok)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	return unwrap(resp)
}

func unwrap(resp *http.Response) (json.RawMessage, error) {
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, fmt.Errorf("unauthorized -- check V42_API_TOKEN")
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API error %d: %s", resp.StatusCode, string(body))
	}

	var env struct {
		Data  json.RawMessage `json:"data"`
		Error *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return body, nil // not an envelope, return raw
	}
	if env.Error != nil {
		return nil, fmt.Errorf("V42 %s: %s", env.Error.Code, env.Error.Message)
	}
	return env.Data, nil
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

var tools = []mcpTool{
	{
		Name:        "list_projects",
		Description: "List all V42 projects visible to the configured user.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
	},
	{
		Name:        "list_backlog",
		Description: "List backlog items for a project. Use filters to narrow results.",
		InputSchema: json.RawMessage(`{
  "type": "object",
  "properties": {
    "project_id": { "type": "string", "description": "Project UUID" },
    "status":     { "type": "string", "description": "Filter: planned|open|in_progress|in_review|done|cancelled" },
    "clarity":    { "type": "string", "description": "Filter: unknown|foggy|tacit|scoped|clear" },
    "epic_id":    { "type": "string", "description": "Filter by epic UUID" }
  },
  "required": ["project_id"]
}`),
	},
	{
		Name:        "get_backlog_item",
		Description: "Get full context of a backlog item: description, acceptance criteria, tasks and tests. Returns formatted Markdown ready to use as an AI prompt.",
		InputSchema: json.RawMessage(`{
  "type": "object",
  "properties": {
    "project_id": { "type": "string", "description": "Project UUID" },
    "item_id":    { "type": "string", "description": "Backlog item UUID" }
  },
  "required": ["project_id", "item_id"]
}`),
	},
	{
		Name:        "list_sprints",
		Description: "List sprints for a project.",
		InputSchema: json.RawMessage(`{
  "type": "object",
  "properties": {
    "project_id": { "type": "string", "description": "Project UUID" }
  },
  "required": ["project_id"]
}`),
	},
	{
		Name:        "update_backlog_status",
		Description: "Update the status of a backlog item. Use to mark in_progress when starting work, in_review when done, done when accepted.",
		InputSchema: json.RawMessage(`{
  "type": "object",
  "properties": {
    "project_id": { "type": "string", "description": "Project UUID" },
    "item_id":    { "type": "string", "description": "Backlog item UUID" },
    "status":     { "type": "string", "description": "New status: planned|open|in_progress|in_review|done|cancelled" }
  },
  "required": ["project_id", "item_id", "status"]
}`),
	},
	{
		Name:        "add_comment",
		Description: "Add a comment to a backlog item. Use to report progress, blockers or decisions.",
		InputSchema: json.RawMessage(`{
  "type": "object",
  "properties": {
    "project_id": { "type": "string", "description": "Project UUID" },
    "item_id":    { "type": "string", "description": "Backlog item UUID" },
    "text":       { "type": "string", "description": "Comment text (Markdown supported)" }
  },
  "required": ["project_id", "item_id", "text"]
}`),
	},
	{
		Name:        "create_task",
		Description: "Create a task under a backlog item.",
		InputSchema: json.RawMessage(`{
  "type": "object",
  "properties": {
    "project_id":   { "type": "string", "description": "Project UUID" },
    "item_id":      { "type": "string", "description": "Backlog item UUID" },
    "title":        { "type": "string", "description": "Task title" },
    "description":  { "type": "string", "description": "Optional description" },
    "skill_required": { "type": "string", "description": "Skill name (optional)" }
  },
  "required": ["project_id", "item_id", "title"]
}`),
	},
	{
		Name:        "update_task_status",
		Description: "Update the status of a task.",
		InputSchema: json.RawMessage(`{
  "type": "object",
  "properties": {
    "project_id": { "type": "string", "description": "Project UUID" },
    "item_id":    { "type": "string", "description": "Backlog item UUID" },
    "task_id":    { "type": "string", "description": "Task UUID" },
    "status":     { "type": "string", "description": "New status: todo|in_progress|done|cancelled" }
  },
  "required": ["project_id", "item_id", "task_id", "status"]
}`),
	},
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

func (c *client) callTool(ctx context.Context, name string, args map[string]any) mcpCallResult {
	text, err := c.dispatch(ctx, name, args)
	if err != nil {
		return mcpCallResult{
			IsError: true,
			Content: []mcpContent{{Type: "text", Text: fmt.Sprintf("Error: %s", err)}},
		}
	}
	return mcpCallResult{Content: []mcpContent{{Type: "text", Text: text}}}
}

func (c *client) dispatch(ctx context.Context, name string, args map[string]any) (string, error) {
	str := func(key string) string {
		v, _ := args[key].(string)
		return v
	}

	switch name {
	case "list_projects":
		return c.listProjects(ctx)

	case "list_backlog":
		pid := str("project_id")
		if pid == "" {
			return "", fmt.Errorf("project_id is required")
		}
		return c.listBacklog(ctx, pid, str("status"), str("clarity"), str("epic_id"))

	case "get_backlog_item":
		pid, iid := str("project_id"), str("item_id")
		if pid == "" || iid == "" {
			return "", fmt.Errorf("project_id and item_id are required")
		}
		return c.getBacklogItem(ctx, pid, iid)

	case "list_sprints":
		pid := str("project_id")
		if pid == "" {
			return "", fmt.Errorf("project_id is required")
		}
		return c.listSprints(ctx, pid)

	case "update_backlog_status":
		pid, iid, status := str("project_id"), str("item_id"), str("status")
		if pid == "" || iid == "" || status == "" {
			return "", fmt.Errorf("project_id, item_id and status are required")
		}
		return c.updateBacklogStatus(ctx, pid, iid, status)

	case "add_comment":
		pid, iid, text := str("project_id"), str("item_id"), str("text")
		if pid == "" || iid == "" || text == "" {
			return "", fmt.Errorf("project_id, item_id and text are required")
		}
		return c.addComment(ctx, pid, iid, text)

	case "create_task":
		pid, iid, title := str("project_id"), str("item_id"), str("title")
		if pid == "" || iid == "" || title == "" {
			return "", fmt.Errorf("project_id, item_id and title are required")
		}
		desc := str("description")
		skill := str("skill_required")
		return c.createTask(ctx, pid, iid, title, desc, skill)

	case "update_task_status":
		pid, iid, tid, status := str("project_id"), str("item_id"), str("task_id"), str("status")
		if pid == "" || iid == "" || tid == "" || status == "" {
			return "", fmt.Errorf("project_id, item_id, task_id and status are required")
		}
		return c.updateTaskStatus(ctx, pid, iid, tid, status)

	default:
		return "", fmt.Errorf("unknown tool: %s", name)
	}
}

// ---------------------------------------------------------------------------
// Individual tool implementations
// ---------------------------------------------------------------------------

func (c *client) listProjects(ctx context.Context) (string, error) {
	data, err := c.get(ctx, "/projects")
	if err != nil {
		return "", err
	}

	var projects []struct {
		ID          string `json:"id"`
		NodeNumber  int    `json:"node_number"`
		Name        string `json:"name"`
		Description string `json:"description"`
		Status      string `json:"status"`
		OpenItems   int    `json:"open_items"`
		TotalItems  int    `json:"total_items"`
	}
	if err := json.Unmarshal(data, &projects); err != nil {
		return string(data), nil
	}

	var b strings.Builder
	b.WriteString("# Projects\n\n")
	b.WriteString("| ID | Name | Status | Open/Total |\n")
	b.WriteString("|----|------|--------|------------|\n")
	for _, p := range projects {
		desc := p.Description
		if len(desc) > 40 {
			desc = desc[:40] + "..."
		}
		fmt.Fprintf(&b, "| `%s` | **%s** | %s | %d/%d |\n",
			p.ID, p.Name, p.Status, p.OpenItems, p.TotalItems)
	}
	return b.String(), nil
}

func (c *client) listBacklog(ctx context.Context, projectID, status, clarity, epicID string) (string, error) {
	path := "/projects/" + projectID + "/backlog"
	sep := "?"
	add := func(k, v string) {
		if v != "" {
			path += sep + k + "=" + v
			sep = "&"
		}
	}
	add("status", status)
	add("clarity", clarity)
	add("epic_id", epicID)
	add("per_page", "100")

	data, err := c.get(ctx, path)
	if err != nil {
		return "", err
	}

	var items []struct {
		ID          string `json:"id"`
		Number      int    `json:"number"`
		Title       string `json:"title"`
		Type        string `json:"type"`
		Status      string `json:"status"`
		Clarity     string `json:"clarity"`
		Estimate    string `json:"estimate"`
		SprintName  string `json:"sprint_name"`
	}
	if err := json.Unmarshal(data, &items); err != nil {
		return string(data), nil
	}

	var b strings.Builder
	fmt.Fprintf(&b, "# Backlog (project: %s)\n\n", projectID)
	b.WriteString("| # | ID | Title | Type | Status | Clarity | SP | Sprint |\n")
	b.WriteString("|---|----|----|---|----|----|---|---|\n")
	for _, it := range items {
		sprint := it.SprintName
		if sprint == "" {
			sprint = "--"
		}
		est := it.Estimate
		if est == "" {
			est = "--"
		}
		fmt.Fprintf(&b, "| B-%d | `%s` | %s | %s | %s | %s | %s | %s |\n",
			it.Number, it.ID, it.Title, it.Type, it.Status, it.Clarity, est, sprint)
	}
	fmt.Fprintf(&b, "\n*%d items*\n", len(items))
	return b.String(), nil
}

func (c *client) getBacklogItem(ctx context.Context, projectID, itemID string) (string, error) {
	// Fetch item, tasks, and tests in parallel via goroutines.
	type result[T any] struct {
		val T
		err error
	}

	itemCh := make(chan result[json.RawMessage], 1)
	tasksCh := make(chan result[json.RawMessage], 1)
	testsCh := make(chan result[json.RawMessage], 1)

	base := "/projects/" + projectID + "/backlog/" + itemID

	go func() { d, e := c.get(ctx, base); itemCh <- result[json.RawMessage]{d, e} }()
	go func() { d, e := c.get(ctx, base+"/tasks"); tasksCh <- result[json.RawMessage]{d, e} }()
	go func() { d, e := c.get(ctx, base+"/tests"); testsCh <- result[json.RawMessage]{d, e} }()

	itemR := <-itemCh
	if itemR.err != nil {
		return "", itemR.err
	}

	var item struct {
		Number      int    `json:"number"`
		Title       string `json:"title"`
		Type        string `json:"type"`
		Status      string `json:"status"`
		Clarity     string `json:"clarity"`
		Estimate    string `json:"estimate"`
		SprintName  string `json:"sprint_name"`
		Description string `json:"description"`
		AcSetup     string `json:"ac_setup"`
		AcSteps     string `json:"ac_steps"`
		AcExpected  string `json:"ac_expected"`
	}
	if err := json.Unmarshal(itemR.val, &item); err != nil {
		return string(itemR.val), nil
	}

	var tasks []struct {
		Title         string `json:"title"`
		Status        string `json:"status"`
		SkillRequired string `json:"skill_required"`
		Estimate      string `json:"estimate"`
	}
	if r := <-tasksCh; r.err == nil {
		_ = json.Unmarshal(r.val, &tasks)
	}

	var tests []struct {
		Title           string `json:"title"`
		Type            string `json:"type"`
		Steps           string `json:"steps"`
		ExpectedResults string `json:"expected_results"`
	}
	if r := <-testsCh; r.err == nil {
		_ = json.Unmarshal(r.val, &tests)
	}

	// Format as Markdown
	var b strings.Builder
	est := item.Estimate
	if est == "" {
		est = "--"
	}
	fmt.Fprintf(&b, "# B-%d: %s\n\n", item.Number, item.Title)
	fmt.Fprintf(&b, "**Type:** %s | **Status:** %s | **Clarity:** %s | **Complexity:** %s\n",
		item.Type, item.Status, item.Clarity, est)
	if item.SprintName != "" {
		fmt.Fprintf(&b, "**Sprint:** %s\n", item.SprintName)
	}
	b.WriteString("\n")

	if item.Description != "" {
		b.WriteString("## Description\n\n")
		b.WriteString(item.Description)
		b.WriteString("\n\n")
	}

	if item.AcSetup != "" || item.AcSteps != "" || item.AcExpected != "" {
		b.WriteString("## Acceptance Criteria\n\n")
		if item.AcSetup != "" {
			b.WriteString("### Given (Setup)\n\n")
			b.WriteString(item.AcSetup)
			b.WriteString("\n\n")
		}
		if item.AcSteps != "" {
			b.WriteString("### When (Steps)\n\n")
			b.WriteString(item.AcSteps)
			b.WriteString("\n\n")
		}
		if item.AcExpected != "" {
			b.WriteString("### Then (Expected)\n\n")
			b.WriteString(item.AcExpected)
			b.WriteString("\n\n")
		}
	}

	if len(tasks) > 0 {
		b.WriteString("## Tasks\n\n")
		for _, t := range tasks {
			done := "[ ]"
			if t.Status == "done" {
				done = "[x]"
			}
			skill := ""
			if t.SkillRequired != "" {
				skill = " *(" + t.SkillRequired + ")*"
			}
			est := ""
			if t.Estimate != "" {
				est = " [" + t.Estimate + "]"
			}
			fmt.Fprintf(&b, "- %s %s%s%s\n", done, t.Title, skill, est)
		}
		b.WriteString("\n")
	}

	if len(tests) > 0 {
		b.WriteString("## Tests\n\n")
		for _, t := range tests {
			fmt.Fprintf(&b, "- [ ] **[%s]** %s\n", t.Type, t.Title)
			if t.Steps != "" {
				fmt.Fprintf(&b, "  - Steps: %s\n", t.Steps)
			}
			if t.ExpectedResults != "" {
				fmt.Fprintf(&b, "  - Expected: %s\n", t.ExpectedResults)
			}
		}
		b.WriteString("\n")
	}

	b.WriteString("---\n")
	fmt.Fprintf(&b, "*project_id: %s | item_id: %s*\n", projectID, itemID)

	return b.String(), nil
}

func (c *client) listSprints(ctx context.Context, projectID string) (string, error) {
	data, err := c.get(ctx, "/projects/"+projectID+"/sprints")
	if err != nil {
		return "", err
	}

	var sprints []struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		Status    string `json:"status"`
		StartDate string `json:"start_date"`
		EndDate   string `json:"end_date"`
	}
	if err := json.Unmarshal(data, &sprints); err != nil {
		return string(data), nil
	}

	var b strings.Builder
	fmt.Fprintf(&b, "# Sprints (project: %s)\n\n", projectID)
	b.WriteString("| ID | Name | Status | Start | End |\n")
	b.WriteString("|----|------|--------|-------|-----|\n")
	for _, s := range sprints {
		fmt.Fprintf(&b, "| `%s` | %s | %s | %s | %s |\n",
			s.ID, s.Name, s.Status, s.StartDate, s.EndDate)
	}
	return b.String(), nil
}

func (c *client) updateBacklogStatus(ctx context.Context, projectID, itemID, status string) (string, error) {
	_, err := c.patch(ctx, "/projects/"+projectID+"/backlog/"+itemID,
		map[string]string{"status": status})
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("Status updated to `%s` for item %s.", status, itemID), nil
}

func (c *client) addComment(ctx context.Context, projectID, itemID, text string) (string, error) {
	_, err := c.post(ctx, "/projects/"+projectID+"/backlog/"+itemID+"/comments",
		map[string]string{"body": text})
	if err != nil {
		return "", err
	}
	return "Comment added.", nil
}

func (c *client) createTask(ctx context.Context, projectID, itemID, title, desc, skill string) (string, error) {
	body := map[string]any{"title": title}
	if desc != "" {
		body["description"] = desc
	}
	if skill != "" {
		body["skill_required"] = skill
	}
	data, err := c.post(ctx, "/projects/"+projectID+"/backlog/"+itemID+"/tasks", body)
	if err != nil {
		return "", err
	}
	var task struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(data, &task); err != nil {
		return "Task created.", nil
	}
	return fmt.Sprintf("Task created: `%s`.", task.ID), nil
}

func (c *client) updateTaskStatus(ctx context.Context, projectID, itemID, taskID, status string) (string, error) {
	path := "/projects/" + projectID + "/backlog/" + itemID + "/tasks/" + taskID
	_, err := c.patch(ctx, path, map[string]string{"status": status})
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("Task %s status updated to `%s`.", taskID, status), nil
}

// ---------------------------------------------------------------------------
// MCP server loop
// ---------------------------------------------------------------------------

type server struct {
	v42 *client
	out *json.Encoder
	log *slog.Logger
}

func (s *server) reply(id *json.RawMessage, result any) {
	_ = s.out.Encode(rpcResponse{JSONRPC: "2.0", ID: id, Result: result})
}

func (s *server) replyErr(id *json.RawMessage, code int, msg string) {
	_ = s.out.Encode(rpcResponse{JSONRPC: "2.0", ID: id, Error: &rpcError{Code: code, Message: msg}})
}

func (s *server) handle(ctx context.Context, req rpcRequest) {
	s.log.Debug("recv", "method", req.Method)

	switch req.Method {
	case "initialize":
		var r mcpInitResult
		r.ProtocolVersion = "2024-11-05"
		r.Capabilities.Tools = &struct{}{}
		r.ServerInfo.Name = "v42-mcp"
		r.ServerInfo.Version = "0.1.0"
		s.reply(req.ID, r)

	case "notifications/initialized":
		// no response needed for notifications

	case "ping":
		s.reply(req.ID, map[string]string{})

	case "tools/list":
		s.reply(req.ID, map[string]any{"tools": tools})

	case "tools/call":
		var p struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil {
			s.replyErr(req.ID, -32602, "invalid params")
			return
		}
		result := s.v42.callTool(ctx, p.Name, p.Arguments)
		s.reply(req.ID, result)

	default:
		s.replyErr(req.ID, -32601, "method not found: "+req.Method)
	}
}

func (s *server) run(ctx context.Context) {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 4*1024*1024), 4*1024*1024) // 4 MB max line

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}

		var req rpcRequest
		if err := json.Unmarshal(line, &req); err != nil {
			s.log.Error("parse error", "err", err, "line", string(line))
			s.replyErr(nil, -32700, "parse error")
			continue
		}

		s.handle(ctx, req)
	}

	if err := scanner.Err(); err != nil {
		s.log.Error("stdin error", "err", err)
	}
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	apiURL := os.Getenv("V42_API_URL")
	if apiURL == "" {
		apiURL = "http://localhost:8080/api/v1"
	}

	apiToken := os.Getenv("V42_API_TOKEN")
	if apiToken == "" {
		log.Error("V42_API_TOKEN is required")
		os.Exit(1)
	}

	log.Info("v42-mcp starting", "url", apiURL)

	srv := &server{
		v42: newClient(apiURL, apiToken),
		out: json.NewEncoder(os.Stdout),
		log: log,
	}

	srv.run(context.Background())
	log.Info("v42-mcp stopped")
}
