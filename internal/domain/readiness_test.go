package domain_test

import (
	"testing"

	"github.com/vpo/v42/internal/domain"
)

func ptr(s string) *string { return &s }

// fullyReady is the baseline input that passes every check.
func fullyReady() domain.ReadinessInput {
	return domain.ReadinessInput{
		Description: ptr("A description long enough to clear the twenty character bar."),
		AcSteps:     ptr("Given X When Y Then Z"),
		Estimate:    ptr("B"),
		Clarity:     "scoped",
		Status:      "backlog",
		TestCount:   2,
	}
}

func TestCheckReadiness_AllPass(t *testing.T) {
	res := domain.CheckReadiness(fullyReady())
	if !res.Ready {
		t.Errorf("expected Ready=true, got false; checks=%+v", res.Checks)
	}
	if res.Score != 1.0 {
		t.Errorf("expected score 1.0, got %v", res.Score)
	}
	if len(res.Suggestions) != 0 {
		t.Errorf("expected no suggestions, got %v", res.Suggestions)
	}
	if len(res.Checks) != 6 {
		t.Errorf("expected 6 checks, got %d", len(res.Checks))
	}
}

// checkByName pulls a single named check out of the result.
func checkByName(res domain.ReadinessResult, name string) (domain.ReadinessCheck, bool) {
	for _, c := range res.Checks {
		if c.Name == name {
			return c, true
		}
	}
	return domain.ReadinessCheck{}, false
}

func TestCheckReadiness_IndividualFailures(t *testing.T) {
	cases := []struct {
		name      string
		mutate    func(in *domain.ReadinessInput)
		failCheck string
	}{
		{"short description", func(in *domain.ReadinessInput) { in.Description = ptr("too short") }, "has_description"},
		{"nil description", func(in *domain.ReadinessInput) { in.Description = nil }, "has_description"},
		{"no ac", func(in *domain.ReadinessInput) { in.AcSteps = nil }, "has_acceptance_criteria"},
		{"blank ac", func(in *domain.ReadinessInput) { in.AcSteps = ptr("   ") }, "has_acceptance_criteria"},
		{"no tests", func(in *domain.ReadinessInput) { in.TestCount = 0 }, "has_tests"},
		{"no estimate", func(in *domain.ReadinessInput) { in.Estimate = nil }, "has_complexity"},
		{"blank estimate", func(in *domain.ReadinessInput) { in.Estimate = ptr("  ") }, "has_complexity"},
		{"low clarity", func(in *domain.ReadinessInput) { in.Clarity = "vague" }, "clarity_sufficient"},
		{"on hold", func(in *domain.ReadinessInput) { in.Status = "on_hold" }, "not_blocked"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := fullyReady()
			tc.mutate(&in)
			res := domain.CheckReadiness(in)

			if res.Ready {
				t.Errorf("expected Ready=false when %s fails", tc.failCheck)
			}
			ch, ok := checkByName(res, tc.failCheck)
			if !ok {
				t.Fatalf("check %q not present in result", tc.failCheck)
			}
			if ch.Pass {
				t.Errorf("expected check %q to fail", tc.failCheck)
			}
			if ch.Note == nil {
				t.Errorf("failed check %q should carry an explanatory note", tc.failCheck)
			}
			if len(res.Suggestions) == 0 {
				t.Errorf("a failed check should yield at least one suggestion")
			}
			// Exactly one check should be failing -> score 5/6.
			want := 5.0 / 6.0
			if res.Score != want {
				t.Errorf("score: want %v (5/6), got %v", want, res.Score)
			}
		})
	}
}

func TestCheckReadiness_ClarityClearAlsoPasses(t *testing.T) {
	in := fullyReady()
	in.Clarity = "clear"
	if ch, _ := checkByName(domain.CheckReadiness(in), "clarity_sufficient"); !ch.Pass {
		t.Error("clarity 'clear' must satisfy clarity_sufficient")
	}
}

func TestCheckReadiness_TestCountPluralization(t *testing.T) {
	in := fullyReady()
	in.TestCount = 1
	ch, _ := checkByName(domain.CheckReadiness(in), "has_tests")
	if ch.Note == nil || *ch.Note != "1 test spec defined" {
		t.Errorf("singular note: want '1 test spec defined', got %v", ch.Note)
	}

	in.TestCount = 3
	ch, _ = checkByName(domain.CheckReadiness(in), "has_tests")
	if ch.Note == nil || *ch.Note != "3 test specs defined" {
		t.Errorf("plural note: want '3 test specs defined', got %v", ch.Note)
	}
}

func TestCheckReadiness_AllFail(t *testing.T) {
	res := domain.CheckReadiness(domain.ReadinessInput{
		Description: nil,
		AcSteps:     nil,
		Estimate:    nil,
		Clarity:     "vague",
		Status:      "on_hold",
		TestCount:   0,
	})
	if res.Ready {
		t.Error("expected Ready=false when everything fails")
	}
	if res.Score != 0.0 {
		t.Errorf("expected score 0.0, got %v", res.Score)
	}
	if len(res.Suggestions) != 6 {
		t.Errorf("expected 6 suggestions, got %d", len(res.Suggestions))
	}
}
