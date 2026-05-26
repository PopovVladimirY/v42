package domain

import (
	"fmt"
	"strings"
)

// ReadinessCheck is a single pass/fail check in a readiness analysis.
type ReadinessCheck struct {
	Name string  `json:"name"`
	Pass bool    `json:"pass"`
	Note *string `json:"note"`
}

// ReadinessResult is the full output of CheckReadiness.
type ReadinessResult struct {
	Ready       bool             `json:"ready"`
	Score       float64          `json:"score"`
	Checks      []ReadinessCheck `json:"checks"`
	Suggestions []string         `json:"suggestions"`
}

// ReadinessInput carries the fields the checker needs -- no DB access here.
type ReadinessInput struct {
	Description *string
	AcSteps     *string
	Estimate    *string
	Clarity     string
	Status      string
	TestCount   int
}

// CheckReadiness evaluates whether a backlog item is ready for dev or agent work.
// All logic is pure -- the handler is responsible for loading the data.
func CheckReadiness(in ReadinessInput) ReadinessResult {
	ptr := func(s string) *string { return &s }
	var checks []ReadinessCheck
	var suggestions []string

	// 1. has_description -- at least 20 non-whitespace chars
	ok := in.Description != nil && len(strings.TrimSpace(*in.Description)) >= 20
	ch := ReadinessCheck{Name: "has_description", Pass: ok}
	if !ok {
		ch.Note = ptr("Description is missing or too short (< 20 chars)")
		suggestions = append(suggestions, "Add a meaningful description explaining what and why")
	}
	checks = append(checks, ch)

	// 2. has_acceptance_criteria -- ac_steps must be non-empty
	ok = in.AcSteps != nil && len(strings.TrimSpace(*in.AcSteps)) > 0
	ch = ReadinessCheck{Name: "has_acceptance_criteria", Pass: ok}
	if !ok {
		ch.Note = ptr("No acceptance criteria (ac_steps) defined")
		suggestions = append(suggestions, "Add explicit acceptance criteria: Given / When / Then steps")
	}
	checks = append(checks, ch)

	// 3. has_tests -- at least one test spec attached
	ok = in.TestCount > 0
	ch = ReadinessCheck{Name: "has_tests", Pass: ok}
	if ok {
		n := fmt.Sprintf("%d test spec%s defined", in.TestCount, pluralS(in.TestCount))
		ch.Note = &n
	} else {
		ch.Note = ptr("No test specs attached")
		suggestions = append(suggestions, "Create at least one test spec so the agent knows what to verify")
	}
	checks = append(checks, ch)

	// 4. has_complexity -- estimate must be set
	ok = in.Estimate != nil && strings.TrimSpace(*in.Estimate) != ""
	ch = ReadinessCheck{Name: "has_complexity", Pass: ok}
	if !ok {
		ch.Note = ptr("No story points / complexity estimate set")
		suggestions = append(suggestions, "Set a complexity estimate (A/B/C or story points) so the team can plan")
	}
	checks = append(checks, ch)

	// 5. clarity_sufficient -- minimum bar is 'scoped'
	ok = in.Clarity == "clear" || in.Clarity == "scoped"
	ch = ReadinessCheck{Name: "clarity_sufficient", Pass: ok}
	if !ok {
		ch.Note = ptr(fmt.Sprintf("Current clarity: %s. Minimum required: scoped", in.Clarity))
		suggestions = append(suggestions, "Raise clarity level to at least 'scoped' before starting development")
	}
	checks = append(checks, ch)

	// 6. not_blocked -- status must not be on_hold
	ok = in.Status != "on_hold"
	ch = ReadinessCheck{Name: "not_blocked", Pass: ok}
	if !ok {
		ch.Note = ptr("Item status is 'on_hold' -- something is blocking it")
		suggestions = append(suggestions, "Resolve the blocker before the agent can proceed")
	}
	checks = append(checks, ch)

	passing := 0
	for _, c := range checks {
		if c.Pass {
			passing++
		}
	}
	score := float64(passing) / float64(len(checks))
	return ReadinessResult{
		Ready:       score == 1.0,
		Score:       score,
		Checks:      checks,
		Suggestions: suggestions,
	}
}

func pluralS(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}
