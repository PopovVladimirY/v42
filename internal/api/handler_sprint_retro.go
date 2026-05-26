package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	dbgen "github.com/vpo/v42/internal/db/gen"
	"github.com/vpo/v42/internal/api/middleware"
)

const retroVoteLimit = 5 // votes per user per sprint

type retroHandlers struct {
	q *dbgen.Queries
}

// retroItemResponse is the API shape for a retro card.
type retroItemResponse struct {
	ID            string  `json:"id"`
	SprintID      string  `json:"sprint_id"`
	AuthorID      string  `json:"author_id"`
	AuthorName    string  `json:"author_name"`
	Category      string  `json:"category"`
	Content       string  `json:"content"`
	IsAction      bool    `json:"is_action"`
	IsResolved    bool    `json:"is_resolved"`
	BacklogItemID *string `json:"backlog_item_id"`
	CreatedAt     string  `json:"created_at"`
	UpdatedAt     string  `json:"updated_at"`
	Votes         int32   `json:"votes"`
	MyVote        bool    `json:"my_vote"`
	MyTotalVotes  int32   `json:"my_total_votes"`
}

// List handles GET /sprints/{id}/retro
// Optional query param: ?view_as=<user_id> (admin/maintainer only) -- returns my_vote/my_total_votes
// from the perspective of the specified user, used by the facilitator to see a member's vote state.
func (h *retroHandlers) List(w http.ResponseWriter, r *http.Request) {
	sprintID := chi.URLParam(r, "id")
	sid, err := parsePGUUID(sprintID)
	if err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid sprint id")
		return
	}
	claims := middleware.ClaimsFromContext(r.Context())
	callerUID, err := parsePGUUID(claims.UserID)
	if err != nil {
		respondErr(w, http.StatusUnauthorized, "UNAUTHORIZED", "invalid caller id")
		return
	}

	// Facilitator mode: allow admin/maintainer to see the board from another user's perspective.
	voterUID := callerUID
	if va := r.URL.Query().Get("view_as"); va != "" {
		if claims.Role != "admin" && claims.Role != "maintainer" {
			respondErr(w, http.StatusForbidden, "FORBIDDEN", "only admin/maintainer can use view_as")
			return
		}
		voterUID, err = parsePGUUID(va)
		if err != nil {
			respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid view_as user id")
			return
		}
	}

	rows, err := h.q.ListRetroItems(r.Context(), dbgen.ListRetroItemsParams{
		SprintID: sid,
		UserID:   voterUID,
	})
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list retro items")
		return
	}

	out := make([]retroItemResponse, 0, len(rows))
	for _, row := range rows {
		out = append(out, buildRetroResponse(row))
	}
	respond(w, http.StatusOK, out)
}

// Create handles POST /sprints/{id}/retro
// Body: { category, content, is_action? }
func (h *retroHandlers) Create(w http.ResponseWriter, r *http.Request) {
	sprintID := chi.URLParam(r, "id")
	sid, err := parsePGUUID(sprintID)
	if err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid sprint id")
		return
	}
	claims := middleware.ClaimsFromContext(r.Context())
	uid, err := parsePGUUID(claims.UserID)
	if err != nil {
		respondErr(w, http.StatusUnauthorized, "UNAUTHORIZED", "invalid caller id")
		return
	}

	var body struct {
		Category string `json:"category"`
		Content  string `json:"content"`
		IsAction bool   `json:"is_action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if body.Content == "" {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "content is required")
		return
	}
	cat := dbgen.RetroCategory(body.Category)
	if !validRetroCategory(cat) {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid category: use went_well | didnt_go_well | to_improve | kudos")
		return
	}

	item, err := h.q.CreateRetroItem(r.Context(), dbgen.CreateRetroItemParams{
		SprintID: sid,
		AuthorID: uid,
		Category: cat,
		Content:  body.Content,
		IsAction: body.IsAction,
	})
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to create retro item")
		return
	}
	respond(w, http.StatusCreated, retroItemFromCreate(item, claims.UserID))
}

// Update handles PATCH /sprints/{id}/retro/{retro_id}
// Body: { content?, is_action? }
func (h *retroHandlers) Update(w http.ResponseWriter, r *http.Request) {
	retroID := chi.URLParam(r, "retro_id")
	rid, err := parsePGUUID(retroID)
	if err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid retro item id")
		return
	}

	// Only author or admin can update -- we check ownership after fetch.
	claims := middleware.ClaimsFromContext(r.Context())

	existing, err := h.q.GetRetroItem(r.Context(), rid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "retro item not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to get retro item")
		return
	}
	if pgUUIDToString(existing.AuthorID) != claims.UserID && claims.Role != "admin" {
		respondErr(w, http.StatusForbidden, "FORBIDDEN", "only author or admin can edit")
		return
	}

	var body struct {
		Content  *string `json:"content"`
		IsAction *bool   `json:"is_action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}

	content := existing.Content
	if body.Content != nil && *body.Content != "" {
		content = *body.Content
	}
	isAction := existing.IsAction
	if body.IsAction != nil {
		isAction = *body.IsAction
	}

	updated, err := h.q.UpdateRetroItem(r.Context(), dbgen.UpdateRetroItemParams{
		ID:       rid,
		Content:  content,
		IsAction: isAction,
	})
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update retro item")
		return
	}
	respond(w, http.StatusOK, retroItemFromUpdate(updated, existing.AuthorName, claims.UserID))
}

// Delete handles DELETE /sprints/{id}/retro/{retro_id}
func (h *retroHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	retroID := chi.URLParam(r, "retro_id")
	rid, err := parsePGUUID(retroID)
	if err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid retro item id")
		return
	}
	claims := middleware.ClaimsFromContext(r.Context())

	existing, err := h.q.GetRetroItem(r.Context(), rid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "retro item not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to get retro item")
		return
	}
	if pgUUIDToString(existing.AuthorID) != claims.UserID && claims.Role != "admin" {
		respondErr(w, http.StatusForbidden, "FORBIDDEN", "only author or admin can delete")
		return
	}

	if err := h.q.DeleteRetroItem(r.Context(), rid); err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to delete retro item")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Vote handles POST /sprints/{id}/retro/{retro_id}/vote
func (h *retroHandlers) Vote(w http.ResponseWriter, r *http.Request) {
	sprintID := chi.URLParam(r, "id")
	retroID := chi.URLParam(r, "retro_id")

	sid, err := parsePGUUID(sprintID)
	if err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid sprint id")
		return
	}
	rid, err := parsePGUUID(retroID)
	if err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid retro item id")
		return
	}
	claims := middleware.ClaimsFromContext(r.Context())
	callerUID, err := parsePGUUID(claims.UserID)
	if err != nil {
		respondErr(w, http.StatusUnauthorized, "UNAUTHORIZED", "invalid caller id")
		return
	}

	// Optional facilitator delegation: admin/maintainer can vote on behalf of a team member.
	voterUID := callerUID
	var body struct {
		OnBehalfOfUserID string `json:"on_behalf_of_user_id"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 256)
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.OnBehalfOfUserID != "" {
		if claims.Role != "admin" && claims.Role != "maintainer" {
			respondErr(w, http.StatusForbidden, "FORBIDDEN", "only admin/maintainer can vote on behalf of others")
			return
		}
		voterUID, err = parsePGUUID(body.OnBehalfOfUserID)
		if err != nil {
			respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid on_behalf_of_user_id")
			return
		}
	}

	// Server-side vote limit -- the DB constraint only dedupes, not caps.
	count, err := h.q.CountUserRetroVotes(r.Context(), dbgen.CountUserRetroVotesParams{
		SprintID: sid,
		UserID:   voterUID,
	})
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to count votes")
		return
	}
	if count >= retroVoteLimit {
		respondErr(w, http.StatusConflict, "VOTE_LIMIT", "all 5 votes for this sprint are used")
		return
	}

	if err := h.q.CastRetroVote(r.Context(), dbgen.CastRetroVoteParams{
		RetroItemID: rid,
		UserID:      voterUID,
	}); err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to cast vote")
		return
	}
	respond(w, http.StatusOK, map[string]any{"voted": true, "total_votes": count + 1})
}

// Unvote handles DELETE /sprints/{id}/retro/{retro_id}/vote
// Optional query param: ?on_behalf_of=<user_id> (admin/maintainer only)
func (h *retroHandlers) Unvote(w http.ResponseWriter, r *http.Request) {
	retroID := chi.URLParam(r, "retro_id")
	rid, err := parsePGUUID(retroID)
	if err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid retro item id")
		return
	}
	claims := middleware.ClaimsFromContext(r.Context())
	voterUID, err := parsePGUUID(claims.UserID)
	if err != nil {
		respondErr(w, http.StatusUnauthorized, "UNAUTHORIZED", "invalid caller id")
		return
	}

	// Optional facilitator delegation via query param (DELETE body is discouraged).
	if ob := r.URL.Query().Get("on_behalf_of"); ob != "" {
		if claims.Role != "admin" && claims.Role != "maintainer" {
			respondErr(w, http.StatusForbidden, "FORBIDDEN", "only admin/maintainer can act on behalf of others")
			return
		}
		voterUID, err = parsePGUUID(ob)
		if err != nil {
			respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid on_behalf_of user id")
			return
		}
	}

	if err := h.q.RetractRetroVote(r.Context(), dbgen.RetractRetroVoteParams{
		RetroItemID: rid,
		UserID:      voterUID,
	}); err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to retract vote")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Resolve handles PATCH /sprints/{id}/retro/{retro_id}/resolve
// Body: { resolved: bool }
func (h *retroHandlers) Resolve(w http.ResponseWriter, r *http.Request) {
	retroID := chi.URLParam(r, "retro_id")
	rid, err := parsePGUUID(retroID)
	if err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid retro item id")
		return
	}

	var body struct {
		Resolved bool `json:"resolved"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}

	updated, err := h.q.ResolveRetroAction(r.Context(), dbgen.ResolveRetroActionParams{
		ID:         rid,
		IsResolved: body.Resolved,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "retro item not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to resolve retro item")
		return
	}
	respond(w, http.StatusOK, map[string]any{
		"id":          pgUUIDToString(updated.ID),
		"is_resolved": updated.IsResolved,
	})
}

// Close handles POST /sprints/{id}/retro/close
func (h *retroHandlers) Close(w http.ResponseWriter, r *http.Request) {
	sprintID := chi.URLParam(r, "id")
	sid, err := parsePGUUID(sprintID)
	if err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid sprint id")
		return
	}
	if err := h.q.CloseRetro(r.Context(), sid); err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to close retro")
		return
	}
	respond(w, http.StatusOK, map[string]any{"retro_closed": true})
}

// -- converters --------------------------------------------------------------

func buildRetroResponse(row dbgen.ListRetroItemsRow) retroItemResponse {
	r := retroItemResponse{
		ID:           pgUUIDToString(row.ID),
		SprintID:     pgUUIDToString(row.SprintID),
		AuthorID:     pgUUIDToString(row.AuthorID),
		AuthorName:   row.AuthorName,
		Category:     string(row.Category),
		Content:      row.Content,
		IsAction:     row.IsAction,
		IsResolved:   row.IsResolved,
		CreatedAt:    row.CreatedAt.Time.UTC().Format("2006-01-02T15:04:05Z"),
		UpdatedAt:    row.UpdatedAt.Time.UTC().Format("2006-01-02T15:04:05Z"),
		Votes:        row.Votes,
		MyVote:       row.MyVote.(bool),
		MyTotalVotes: row.MyTotalVotes,
	}
	if row.BacklogItemID.Valid {
		s := pgUUIDToString(row.BacklogItemID)
		r.BacklogItemID = &s
	}
	return r
}

func retroItemFromCreate(item dbgen.RetrospectiveItem, callerID string) retroItemResponse {
	r := retroItemResponse{
		ID:         pgUUIDToString(item.ID),
		SprintID:   pgUUIDToString(item.SprintID),
		AuthorID:   pgUUIDToString(item.AuthorID),
		Category:   string(item.Category),
		Content:    item.Content,
		IsAction:   item.IsAction,
		IsResolved: item.IsResolved,
		CreatedAt:  item.CreatedAt.Time.UTC().Format("2006-01-02T15:04:05Z"),
		UpdatedAt:  item.UpdatedAt.Time.UTC().Format("2006-01-02T15:04:05Z"),
		Votes:      0,
		MyVote:     false,
	}
	// AuthorName is not in the RETURNING shape -- caller gets their own item, name is not critical here.
	if item.BacklogItemID.Valid {
		s := pgUUIDToString(item.BacklogItemID)
		r.BacklogItemID = &s
	}
	return r
}

func retroItemFromUpdate(item dbgen.RetrospectiveItem, authorName, callerID string) retroItemResponse {
	r := retroItemResponse{
		ID:         pgUUIDToString(item.ID),
		SprintID:   pgUUIDToString(item.SprintID),
		AuthorID:   pgUUIDToString(item.AuthorID),
		AuthorName: authorName,
		Category:   string(item.Category),
		Content:    item.Content,
		IsAction:   item.IsAction,
		IsResolved: item.IsResolved,
		CreatedAt:  item.CreatedAt.Time.UTC().Format("2006-01-02T15:04:05Z"),
		UpdatedAt:  item.UpdatedAt.Time.UTC().Format("2006-01-02T15:04:05Z"),
	}
	if item.BacklogItemID.Valid {
		s := pgUUIDToString(item.BacklogItemID)
		r.BacklogItemID = &s
	}
	return r
}

func validRetroCategory(c dbgen.RetroCategory) bool {
	switch c {
	case dbgen.RetroCategoryWentWell,
		dbgen.RetroCategoryDidntGoWell,
		dbgen.RetroCategoryToImprove,
		dbgen.RetroCategoryKudos:
		return true
	}
	return false
}
