package main

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// The content security policy is written three times, by hand, in three files.
// serve.go sends one copy as a header. src-tauri/tauri.conf.json gives the
// desktop webview its own. web/index.html carries a third in a meta tag, and
// both builds load that document, so the meta copy must satisfy both.
//
// Nothing else checks that the three agree. A directive widened in one file and
// forgotten in the others lets a resource load in one build and be refused in
// another, with no test going red. This file is that check.
//
// The copies are NOT compared as whole strings. They differ for good reasons,
// listed below. They are parsed into directive -> set of sources and compared
// one directive at a time.

// goPolicyFile names the Go copy in failure messages. The other two are read
// from disk, so their paths name themselves.
const goPolicyFile = "serve/serve.go"

const (
	tauriPolicyFile = "src-tauri/tauri.conf.json"
	metaPolicyFile  = "web/index.html"
)

// webviewAllowance is the set of sources a webview build needs and the Go
// server has no use for. Tauri serves the interface over its own protocols:
// ipc: carries the calls into Rust, and asset: reads files off the user's disk.
// The Go server answers over http, so these origins are unreachable there and
// listing them would only widen the served policy for nothing.
//
// These sources are subtracted from every copy before the copies are compared.
var webviewAllowance = map[string]bool{
	"ipc:":                   true,
	"http://ipc.localhost":   true,
	"asset:":                 true,
	"http://asset.localhost": true,
}

// mustAgree lists the directives that carry the same meaning in every build, so
// every copy that declares one must declare the same sources for it.
var mustAgree = []string{
	"default-src",
	"script-src",
	"object-src",
	"base-uri",
	"form-action",
	"connect-src",
	"style-src",
	"font-src",
	"img-src",
	"media-src",
}

// excluded lists the directives that differ on purpose, with the reason.
//
//   - frame-ancestors: serve.go sends 'self', because the marketing site pins
//     the real interface in as a same-origin frame. Tauri sends 'none', because
//     nothing frames the desktop window. The meta tag omits it, because
//     frame-ancestors is ignored in a meta tag: the specification only honours
//     it in a header, so writing it there would say nothing.
var excluded = map[string]string{
	"frame-ancestors": "different by design, and ignored in a meta tag",
}

// knownDivergence records the differences that exist today and are NOT yet
// fixed. Each one is logged instead of failing the test, so the suite stays
// honest about what is broken without hiding it. A new difference fails. A
// recorded difference that goes away also fails, so the entry gets removed.
//
// It is empty. Every directive in mustAgree is enforced by plain agreement.
var knownDivergence = map[string]string{}

// parsePolicy turns a policy string into directive -> set of sources.
//
// Directives are separated by ";". The first token of a directive is its name,
// and the rest are its sources. Sources are held as a set, because their order
// carries no meaning. The webview allowance is removed here, so the callers
// compare only what every build should share.
func parsePolicy(policy string) map[string]map[string]bool {
	parsed := map[string]map[string]bool{}

	for _, part := range strings.Split(policy, ";") {
		fields := strings.Fields(part)
		if len(fields) == 0 {
			continue
		}

		sources := map[string]bool{}
		for _, source := range fields[1:] {
			if webviewAllowance[source] {
				continue
			}
			sources[source] = true
		}

		parsed[fields[0]] = sources
	}

	return parsed
}

// readTauriPolicy returns the policy the desktop shell sends.
func readTauriPolicy(t *testing.T) string {
	t.Helper()

	raw, err := os.ReadFile("../" + tauriPolicyFile)
	if err != nil {
		t.Fatalf("read %s: %v", tauriPolicyFile, err)
	}

	var config struct {
		App struct {
			Security struct {
				CSP string `json:"csp"`
			} `json:"security"`
		} `json:"app"`
	}

	if err := json.Unmarshal(raw, &config); err != nil {
		t.Fatalf("parse %s: %v", tauriPolicyFile, err)
	}

	if config.App.Security.CSP == "" {
		t.Fatalf("%s: app.security.csp is empty or missing", tauriPolicyFile)
	}

	return config.App.Security.CSP
}

var metaPattern = regexp.MustCompile(`(?i)<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"`)

// readMetaPolicy returns the policy the entry document carries.
func readMetaPolicy(t *testing.T) string {
	t.Helper()

	raw, err := os.ReadFile("../" + metaPolicyFile)
	if err != nil {
		t.Fatalf("read %s: %v", metaPolicyFile, err)
	}

	match := metaPattern.FindSubmatch(raw)
	if match == nil {
		t.Fatalf("%s: no Content-Security-Policy meta tag found", metaPolicyFile)
	}

	return string(match[1])
}

// sorted returns a set as a readable list, so a failure names the sources.
func sorted(set map[string]bool) string {
	list := make([]string, 0, len(set))
	for source := range set {
		list = append(list, source)
	}
	sort.Strings(list)

	return strings.Join(list, " ")
}

// difference returns the members of left that are absent from right.
func difference(left, right map[string]bool) map[string]bool {
	only := map[string]bool{}
	for source := range left {
		if !right[source] {
			only[source] = true
		}
	}

	return only
}

func TestPolicyCopiesAgree(t *testing.T) {
	reference := parsePolicy(Policy)

	copies := []struct {
		file   string
		policy map[string]map[string]bool
	}{
		{tauriPolicyFile, parsePolicy(readTauriPolicy(t))},
		{metaPolicyFile, parsePolicy(readMetaPolicy(t))},
	}

	// seen records which known divergences this run actually met, so a
	// divergence that has been fixed stops being excused.
	seen := map[string]bool{}

	// report either logs a known divergence or fails on a new one.
	report := func(key, detail string) {
		if reason, known := knownDivergence[key]; known {
			seen[key] = true
			t.Logf("known divergence: %s (%s)", detail, reason)

			return
		}

		t.Error(detail)
	}

	for _, directive := range mustAgree {
		if reason, skip := excluded[directive]; skip {
			t.Fatalf("%s is in both mustAgree and excluded (%s)", directive, reason)
		}

		want, declared := reference[directive]

		for _, copied := range copies {
			got, present := copied.policy[directive]

			if declared && !present {
				report(
					fmt.Sprintf("%s %s absent", copied.file, directive),
					fmt.Sprintf("%s declares no %s, but %s declares %q", copied.file, directive, goPolicyFile, sorted(want)),
				)

				continue
			}

			if !declared && present {
				report(
					fmt.Sprintf("%s %s extra", copied.file, directive),
					fmt.Sprintf("%s declares %s %q, but %s declares no %s", copied.file, directive, sorted(got), goPolicyFile, directive),
				)

				continue
			}

			if !declared {
				continue
			}

			for source := range difference(want, got) {
				report(
					fmt.Sprintf("%s %s missing %s", copied.file, directive, source),
					fmt.Sprintf("%s %s is missing %q, which %s allows", copied.file, directive, source, goPolicyFile),
				)
			}

			for source := range difference(got, want) {
				report(
					fmt.Sprintf("%s %s extra %s", copied.file, directive, source),
					fmt.Sprintf("%s %s allows %q, which %s does not", copied.file, directive, source, goPolicyFile),
				)
			}
		}
	}

	for key, reason := range knownDivergence {
		if !seen[key] {
			t.Errorf("knownDivergence entry %q (%s) no longer happens, so remove it", key, reason)
		}
	}
}

// TestPolicyExclusionsAreDeliberate makes sure the excluded directives stay
// excluded for the reason written down, and that no directive is silently
// dropped from both lists.
func TestPolicyExclusionsAreDeliberate(t *testing.T) {
	covered := map[string]bool{}
	for _, directive := range mustAgree {
		covered[directive] = true
	}
	for directive := range excluded {
		covered[directive] = true
	}

	for directive := range parsePolicy(Policy) {
		if !covered[directive] {
			t.Errorf("%s declares %s, which is neither in mustAgree nor in excluded", goPolicyFile, directive)
		}
	}
}
