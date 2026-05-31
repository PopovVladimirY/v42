package api

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/vpo/v42/internal/db/store"
	"github.com/vpo/v42/internal/domain"
)

// Data-isolation guards.
//
// Nested routes carry their full ancestry in the URL
// (project_id -> sprint | backlog_item -> task -> leaf). The leaf stores fetch
// by id alone, so without these checks an attacker could pair a valid leaf id
// from project B with project A in the path and waltz right past. Each guard
// re-fetches the named entity and confirms it actually hangs off the parent
// named in the URL.
//
// We answer 404 (not 403) on mismatch on purpose: never confirm the existence
// of data the caller has no business seeing. A missing parent and a foreign
// parent look identical from the outside. Mum's the word.

// ensureSprintInProject verifies the {id} sprint belongs to {project_id}.
// On any mismatch it writes the response and returns false.
func ensureSprintInProject(w http.ResponseWriter, r *http.Request, sprints *store.SprintStore) bool {
	s, err := sprints.GetByID(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "sprint not found")
			return false
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to verify sprint")
		return false
	}
	if s.ProjectID != chi.URLParam(r, "project_id") {
		respondErr(w, http.StatusNotFound, "NOT_FOUND", "sprint not found")
		return false
	}
	return true
}

// ensureItemInProject verifies the {backlog_item_id} item belongs to {project_id}.
func ensureItemInProject(w http.ResponseWriter, r *http.Request, backlog *store.BacklogStore) bool {
	item, err := backlog.GetByID(r.Context(), chi.URLParam(r, "backlog_item_id"))
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "backlog item not found")
			return false
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to verify backlog item")
		return false
	}
	if item.ProjectID != chi.URLParam(r, "project_id") {
		respondErr(w, http.StatusNotFound, "NOT_FOUND", "backlog item not found")
		return false
	}
	return true
}

// ensureTaskInItem verifies the {task_id} task belongs to {backlog_item_id}.
// Pair it with ensureItemInProject to validate the whole project->item->task chain.
func ensureTaskInItem(w http.ResponseWriter, r *http.Request, tasks *store.TaskStore) bool {
	t, err := tasks.GetByID(r.Context(), chi.URLParam(r, "task_id"))
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "task not found")
			return false
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to verify task")
		return false
	}
	if t.BacklogItemID != chi.URLParam(r, "backlog_item_id") {
		respondErr(w, http.StatusNotFound, "NOT_FOUND", "task not found")
		return false
	}
	return true
}

// guards bundles the stores needed for the middleware form of the isolation
// checks. Used on sub-routers that already group a parent id (sprint capacity
// and retro), where a single Use() guards every child route at once.
type guards struct {
	sprints *store.SprintStore
}

// requireSprintInProject is the middleware flavour of ensureSprintInProject,
// for sub-routers mounted under /projects/{project_id}/sprints/{id}/...
func (g *guards) requireSprintInProject(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !ensureSprintInProject(w, r, g.sprints) {
			return
		}
		next.ServeHTTP(w, r)
	})
}
