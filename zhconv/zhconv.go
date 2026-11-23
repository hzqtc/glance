// Package zhconv converts Traditional Chinese text to Simplified Chinese,
// character by character, using the OpenCC character table in table.go.
package zhconv

import (
	"strings"
	"sync"
)

var (
	tsOnce sync.Once
	tsMap  map[rune]rune
)

func loadTable() {
	runes := []rune(tsPairs)
	tsMap = make(map[rune]rune, len(runes)/2)
	for i := 0; i+1 < len(runes); i += 2 {
		tsMap[runes[i]] = runes[i+1]
	}
}

// ToSimplified converts Traditional Chinese characters in s to Simplified;
// all other text is returned unchanged.
func ToSimplified(s string) string {
	tsOnce.Do(loadTable)
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if simp, ok := tsMap[r]; ok {
			b.WriteRune(simp)
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}
