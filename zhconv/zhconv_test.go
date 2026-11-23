package zhconv

import "testing"

func TestToSimplified(t *testing.T) {
	cases := map[string]string{
		"分析：APEC上與習近平、特朗普歷史性會晤，對普京是一場重大勝利": "分析：APEC上与习近平、特朗普历史性会晤，对普京是一场重大胜利",
		"凱特王妃在BBC紀錄片《療癒》中談癌症如何改變了她":        "凯特王妃在BBC纪录片《疗愈》中谈癌症如何改变了她",
		"Hello 世界 123": "Hello 世界 123",
		"":             "",
	}
	for in, want := range cases {
		if got := ToSimplified(in); got != want {
			t.Errorf("ToSimplified(%q) = %q, want %q", in, got, want)
		}
	}
}
