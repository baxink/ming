"""
评估工具

负责评估 LLM 代理输出的历史准确性和决策质量
"""
from dataclasses import dataclass, field
from enum import Enum


class EvalMetric(Enum):
    HISTORICAL_ACCURACY = "historical_accuracy"
    INSTITUTIONAL_CORRECTNESS = "institutional_correctness"
    CHARACTER_CONSISTENCY = "character_consistency"
    STYLE_APPROPRIATENESS = "style_appropriateness"
    GEOPOLITICAL_PLAUSIBILITY = "geopolitical_plausibility"


@dataclass
class EvalResult:
    metric: EvalMetric
    score: float           # 0-1
    explanation: str = ""
    issues: list[str] = field(default_factory=list)


class Evaluator:
    """LLM 代理输出评估器"""

    def __init__(self):
        self.criteria: dict[str, list[str]] = {
            "historical_accuracy": [
                "人物是否在正确的时间点存在",
                "事件发生顺序是否符合史实",
                "地名是否与当时行政划分一致",
            ],
            "institutional_correctness": [
                "官职权限是否符合制度",
                "政令流转路径是否正确",
                "决策是否遵守了行政规则",
            ],
            "character_consistency": [
                "决策是否符合人物性格设定",
                "行为是否与历史记载一致",
                "关系网络是否影响决策",
            ],
            "style_appropriateness": [
                "文书格式是否符合明代规范",
                "用词是否符合时代特征",
                "称谓是否恰当",
            ],
            "geopolitical_plausibility": [
                "军事行动是否符合地理约束",
                "物资运输时间是否合理",
                "区域影响范围是否准确",
            ],
        }

    def evaluate(self, agent_output: dict, context: dict) -> list[EvalResult]:
        results = []
        for metric, checks in self.criteria.items():
            score = 0.5
            issues = []
            for check in checks:
                if self._check_criterion(metric, check, agent_output, context):
                    score += 0.1
                else:
                    issues.append(check)
            score = min(1.0, score)
            results.append(EvalResult(
                metric=EvalMetric(metric),
                score=score,
                issues=issues,
                explanation=f"{metric}: {score:.2f}",
            ))
        return results

    def _check_criterion(self, metric: str, check: str, output: dict, context: dict) -> bool:
        return True


def run_benchmark(scenarios: list[dict]) -> dict:
    """运行基准测试"""
    evaluator = Evaluator()
    results = {}
    for scenario in scenarios:
        scenario_id = scenario.get("id", "unknown")
        results[scenario_id] = evaluator.evaluate(
            agent_output={},
            context=scenario,
        )
    return results
