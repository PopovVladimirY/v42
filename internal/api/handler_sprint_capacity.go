package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	dbgen "github.com/vpo/v42/internal/db/gen"
)

// sprintCapacityHandlers drives the sprint capacity tab.
type sprintCapacityHandlers struct {
	q *dbgen.Queries
}

// capacityRow is the API-facing shape for one user's capacity in a sprint.
type capacityRow struct {
	UserID       string  `json:"user_id"`
	UserName     string  `json:"user_name"`
	PlannedHours string  `json:"planned_hours"`
	ActualHours  *string `json:"actual_hours"`
	Notes        *string `json:"notes"`
}

// skillCapacityRow is the API shape for skill-level planned hours aggregate.
type skillCapacityRow struct {
	SkillID      string `json:"skill_id"`
	SkillName    string `json:"skill_name"`
	PlannedHours string `json:"planned_hours"`
}

// velocityPoint is one sprint's data in the velocity chart.
type velocityPoint struct {
	SprintID           string  `json:"sprint_id"`
	SprintName         string  `json:"sprint_name"`
	StartDate          string  `json:"start_date"`
	EndDate            string  `json:"end_date"`
	TotalItems         int64   `json:"total_items"`
	DoneItems          int64   `json:"done_items"`
	PlannedHours       string  `json:"planned_hours"`
	ActualHours        string  `json:"actual_hours"`
	VelocityNormalized *string `json:"velocity_normalized"`
}

// GetCapacity handles GET /projects/{project_id}/sprints/{id}/capacity
func (h *sprintCapacityHandlers) GetCapacity(w http.ResponseWriter, r *http.Request) {
	sprintID := chi.URLParam(r, "id")
	sid, err := parsePGUUID(sprintID)
	if err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid sprint id")
		return
	}

	rows, err := h.q.ListSprintCapacity(r.Context(), sid)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list capacity")
		return
	}

	// Skill breakdown in the same call to save round trips.
	skills, err := h.q.GetSkillCapacityBySprint(r.Context(), sid)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to get skill breakdown")
		return
	}

	capacity := make([]capacityRow, 0, len(rows))
	for _, r := range rows {
		row := capacityRow{
			UserID:       pgUUIDToString(r.UserID),
			UserName:     r.UserName,
			PlannedHours: pgNumericToString(r.PlannedHours),
			Notes:        r.Notes,
		}
		if r.ActualHours.Valid {
			s := pgNumericToString(r.ActualHours)
			row.ActualHours = &s
		}
		capacity = append(capacity, row)
	}

	skillBreakdown := make([]skillCapacityRow, 0, len(skills))
	for _, s := range skills {
		skillBreakdown = append(skillBreakdown, skillCapacityRow{
			SkillID:      pgUUIDToString(s.SkillID),
			SkillName:    s.SkillName,
			PlannedHours: pgNumericToString(s.PlannedHours),
		})
	}

	respond(w, http.StatusOK, map[string]any{
		"capacity":        capacity,
		"skill_breakdown": skillBreakdown,
	})
}

// PutCapacity handles PUT /projects/{project_id}/sprints/{id}/capacity
// Body: [{ user_id, planned_hours, notes? }]
func (h *sprintCapacityHandlers) PutCapacity(w http.ResponseWriter, r *http.Request) {
	sprintID := chi.URLParam(r, "id")
	sid, err := parsePGUUID(sprintID)
	if err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid sprint id")
		return
	}

	var body []struct {
		UserID       string  `json:"user_id"`
		PlannedHours string  `json:"planned_hours"`
		Notes        *string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if len(body) == 0 {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "body must be non-empty array")
		return
	}

	results := make([]capacityRow, 0, len(body))
	for _, item := range body {
		uid, err := parsePGUUID(item.UserID)
		if err != nil {
			respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid user_id: "+item.UserID)
			return
		}
		var hours pgtype.Numeric
		if err := hours.Scan(item.PlannedHours); err != nil {
			respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid planned_hours for "+item.UserID)
			return
		}
		row, err := h.q.UpsertSprintCapacity(r.Context(), dbgen.UpsertSprintCapacityParams{
			SprintID:     sid,
			UserID:       uid,
			PlannedHours: hours,
			Notes:        item.Notes,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				respondErr(w, http.StatusNotFound, "NOT_FOUND", "sprint or user not found")
				return
			}
			respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "upsert failed")
			return
		}
		cr := capacityRow{
			UserID:       pgUUIDToString(row.UserID),
			PlannedHours: pgNumericToString(row.PlannedHours),
			Notes:        row.Notes,
		}
		if row.ActualHours.Valid {
			s := pgNumericToString(row.ActualHours)
			cr.ActualHours = &s
		}
		results = append(results, cr)
	}

	respond(w, http.StatusOK, results)
}

// PatchCapacity handles PATCH /projects/{project_id}/sprints/{id}/capacity/{user_id}
// Body: { actual_hours, notes? }
func (h *sprintCapacityHandlers) PatchCapacity(w http.ResponseWriter, r *http.Request) {
	sprintID := chi.URLParam(r, "id")
	userID := chi.URLParam(r, "user_id")

	sid, err := parsePGUUID(sprintID)
	if err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid sprint id")
		return
	}
	uid, err := parsePGUUID(userID)
	if err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid user id")
		return
	}

	var body struct {
		ActualHours string  `json:"actual_hours"`
		Notes       *string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}

	var hours pgtype.Numeric
	if err := hours.Scan(body.ActualHours); err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid actual_hours value")
		return
	}

	row, err := h.q.PatchSprintCapacityActual(r.Context(), dbgen.PatchSprintCapacityActualParams{
		SprintID:    sid,
		UserID:      uid,
		ActualHours: hours,
		Notes:       body.Notes,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "capacity row not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "patch failed")
		return
	}

	cr := capacityRow{
		UserID:       pgUUIDToString(row.UserID),
		PlannedHours: pgNumericToString(row.PlannedHours),
		Notes:        row.Notes,
	}
	if row.ActualHours.Valid {
		s := pgNumericToString(row.ActualHours)
		cr.ActualHours = &s
	}
	respond(w, http.StatusOK, cr)
}

// InitCapacity handles POST /projects/{project_id}/sprints/{id}/capacity/init
// Seeds capacity rows from team members. Body: { team_id }
func (h *sprintCapacityHandlers) InitCapacity(w http.ResponseWriter, r *http.Request) {
	sprintID := chi.URLParam(r, "id")
	sid, err := parsePGUUID(sprintID)
	if err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid sprint id")
		return
	}

	var body struct {
		TeamID string `json:"team_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.TeamID == "" {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "team_id required")
		return
	}
	tid, err := parsePGUUID(body.TeamID)
	if err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid team_id")
		return
	}

	// Pull team members to seed capacity rows with zero hours.
	members, err := h.q.ListTeamMembers(r.Context(), tid)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list team members")
		return
	}
	if len(members) == 0 {
		respondErr(w, http.StatusUnprocessableEntity, "EMPTY_TEAM", "team has no members")
		return
	}

	var zero pgtype.Numeric
	_ = zero.Scan("0")

	for _, m := range members {
		_, err := h.q.UpsertSprintCapacity(r.Context(), dbgen.UpsertSprintCapacityParams{
			SprintID:     sid,
			UserID:       m.UserID,
			PlannedHours: zero,
		})
		if err != nil {
			respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to seed capacity for "+pgUUIDToString(m.UserID))
			return
		}
	}

	respond(w, http.StatusCreated, map[string]any{"seeded": len(members)})
}

// GetVelocity handles GET /projects/{project_id}/velocity
func (h *sprintCapacityHandlers) GetVelocity(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	pid, err := parsePGUUID(projectID)
	if err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid project id")
		return
	}

	rows, err := h.q.GetVelocityHistory(r.Context(), pid)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to get velocity history")
		return
	}

	out := make([]velocityPoint, 0, len(rows))
	for _, r := range rows {
		vp := velocityPoint{
			SprintID:     pgUUIDToString(r.ID),
			SprintName:   r.Name,
			StartDate:    dateToString(r.StartDate),
			EndDate:      dateToString(r.EndDate),
			TotalItems:   r.TotalItems,
			DoneItems:    r.DoneItems,
			PlannedHours: pgNumericToString(r.PlannedHours),
			ActualHours:  pgNumericToString(r.ActualHours),
		}
		if r.VelocityNormalized != nil {
			s := formatVelocity(r.VelocityNormalized)
			vp.VelocityNormalized = &s
		}
		out = append(out, vp)
	}
	respond(w, http.StatusOK, out)
}

// -- helpers used only in this file ------------------------------------------

// parsePGUUID is a local alias so we don't need to import store just for parseUUID.
// (uuidToString / parseUUID live in store/auth.go; handler files use pgtype directly.)
func parsePGUUID(s string) (pgtype.UUID, error) {
	var u pgtype.UUID
	return u, u.Scan(s)
}

func pgUUIDToString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	b := u.Bytes
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func pgNumericToString(n pgtype.Numeric) string {
	if !n.Valid {
		return "0"
	}
	f, err := n.Float64Value()
	if err != nil || !f.Valid {
		return "0"
	}
	return strconv.FormatFloat(f.Float64, 'f', -1, 64)
}

func dateToString(d pgtype.Date) string {
	if !d.Valid {
		return ""
	}
	return d.Time.Format("2006-01-02")
}

func formatVelocity(v any) string {
	switch val := v.(type) {
	case float64:
		return strconv.FormatFloat(val, 'f', 2, 64)
	case string:
		return val
	default:
		return "0"
	}
}
