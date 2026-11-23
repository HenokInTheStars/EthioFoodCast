"""Evaluation metrics, in the priority order the project argues for.

PR-AUC leads. With an imbalanced positive class ROC-AUC flatters a model by
rewarding it on abundant negatives, while precision-recall reflects the actual
screening task. Accuracy is reported last and treated as near-useless here.

`precision_at_k` is the metric that matches how the system would really be
used: an office can visit k households, so what matters is how many of the top
k ranked cases are genuinely food insecure.
"""

from __future__ import annotations

import numpy as np
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)


def precision_at_k(y_true, y_score, k_fraction: float = 0.25) -> float:
    """Precision among the top `k_fraction` of households by predicted risk."""
    y_true = np.asarray(y_true)
    k = max(1, int(round(k_fraction * len(y_true))))
    top = np.argsort(np.asarray(y_score))[::-1][:k]
    return float(y_true[top].mean())


def recall_at_precision(y_true, y_score, floor: float = 0.7) -> float:
    """Best recall achievable while holding precision at or above `floor`."""
    from sklearn.metrics import precision_recall_curve

    precision, recall, _ = precision_recall_curve(y_true, y_score)
    feasible = recall[precision >= floor]
    return float(feasible.max()) if feasible.size else 0.0


def threshold_for_recall(y_true, y_score, target_recall: float = 0.8) -> float:
    """Lowest threshold meeting `target_recall`, chosen on validation only.

    A false negative is a household that goes hungry unflagged; a false
    positive costs one assessment visit. The asymmetry is why the threshold is
    set by recall rather than by maximising accuracy or F1.
    """
    from sklearn.metrics import precision_recall_curve

    precision, recall, thresholds = precision_recall_curve(y_true, y_score)
    feasible = np.where(recall[:-1] >= target_recall)[0]
    if feasible.size == 0:
        return 0.5
    return float(thresholds[feasible[-1]])


def threshold_for_precision(y_true, y_score, target_precision: float = 0.75) -> float:
    """Lowest threshold that still reaches `target_precision`.

    The mirror of `threshold_for_recall`. Which one to use is a policy choice,
    not a technical one: recall-first suits screening where a missed household
    is the costly error, precision-first suits a fixed assessment budget where
    every wasted visit has a price.
    """
    from sklearn.metrics import precision_recall_curve

    precision, _, thresholds = precision_recall_curve(y_true, y_score)
    feasible = np.where(precision[:-1] >= target_precision)[0]
    if feasible.size == 0:
        return 0.5
    return float(thresholds[feasible[0]])


def threshold_for_accuracy(y_true, y_score) -> float:
    """Threshold maximising plain accuracy on the validation rows.

    Included so an accuracy target can be pursued honestly rather than by
    eyeballing a sweep. It is still chosen on held-out inner folds and applied
    to untouched outer folds, and accuracy must always be reported next to
    recall: on a 58/42 split, accuracy rises fastest by predicting the majority
    class, which hides missed food-insecure households.
    """
    import numpy as np

    y_true = np.asarray(y_true).astype(int)
    y_score = np.asarray(y_score, dtype=float)
    if y_score.size == 0:
        return 0.5

    # Every distinct score is a decision boundary, plus one above the maximum
    # so that "predict everyone negative" is reachable. A quantile grid can
    # never exceed max(score), so that option was previously unreachable --
    # and on an imbalanced sample it is sometimes the accuracy optimum.
    boundaries = np.unique(y_score)
    boundaries = np.append(boundaries, np.nextafter(boundaries[-1], np.inf))

    # Only cuts BETWEEN distinct score groups are reachable. A threshold
    # cannot separate two rows that share a score, so sweeping every index
    # proposes impossible cuts and can return one of them -- on
    # labels [0,0,0,1,0] with scores [.1,.1,.5,.5,.9] that returned a 60%
    # threshold when 80% was available.
    order = np.argsort(y_score, kind="mergesort")
    sorted_scores, sorted_truth = y_score[order], y_true[order]

    positives = int(sorted_truth.sum())

    # Cumulative counts at every index; only group boundaries are then read.
    true_negatives = np.concatenate(([0], np.cumsum(sorted_truth == 0)))
    false_negatives = np.concatenate(([0], np.cumsum(sorted_truth == 1)))
    correct = true_negatives + (positives - false_negatives)

    # Index positions where the score actually changes, plus both extremes.
    changes = np.flatnonzero(np.diff(sorted_scores)) + 1
    cuts = np.concatenate(([0], changes, [len(sorted_scores)]))

    best_cut = int(cuts[np.argmax(correct[cuts])])

    if best_cut == 0:
        return float(np.nextafter(sorted_scores[0], -np.inf))
    if best_cut >= len(sorted_scores):
        return float(boundaries[-1])
    return float(sorted_scores[best_cut])


def threshold_for_f1(y_true, y_score) -> float:
    """Threshold maximising F1 -- the balanced compromise."""
    from sklearn.metrics import precision_recall_curve

    precision, recall, thresholds = precision_recall_curve(y_true, y_score)
    with np.errstate(divide="ignore", invalid="ignore"):
        f1 = 2 * precision[:-1] * recall[:-1] / (precision[:-1] + recall[:-1])
    f1 = np.nan_to_num(f1)
    return float(thresholds[int(np.argmax(f1))]) if thresholds.size else 0.5


def evaluate(y_true, y_score, threshold: float = 0.5) -> dict:
    """Full metric set for one fold."""
    y_true = np.asarray(y_true).astype(int)
    y_score = np.asarray(y_score, dtype=float)
    y_pred = (y_score >= threshold).astype(int)

    single_class = len(np.unique(y_true)) < 2

    # The confusion matrix is always well defined -- `labels=[0, 1]` forces the
    # full 2x2 even when only one class is present. Returning four zeros in
    # that case reported tp=0 for two correctly predicted positives, which made
    # a perfect fold look like a failed one. Only the *ranking* metrics are
    # undefined on a single class.
    tn, fp, fn, tp = confusion_matrix(y_true, y_pred, labels=[0, 1]).ravel()

    return {
        "pr_auc": float(average_precision_score(y_true, y_score)) if not single_class else np.nan,
        "roc_auc": float(roc_auc_score(y_true, y_score)) if not single_class else np.nan,
        "recall": float(recall_score(y_true, y_pred, zero_division=0)),
        "precision": float(precision_score(y_true, y_pred, zero_division=0)),
        "f1": float(f1_score(y_true, y_pred, zero_division=0)),
        "precision_at_25pct": precision_at_k(y_true, y_score, 0.25),
        "recall_at_precision_70": recall_at_precision(y_true, y_score, 0.70),
        "brier": float(brier_score_loss(y_true, y_score)),
        "accuracy": float((y_pred == y_true).mean()),
        "n": int(len(y_true)),
        "positive_rate": float(y_true.mean()),
        "tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp),
    }


def summarise(fold_metrics: list[dict]) -> dict:
    """Mean and standard deviation across outer folds.

    The spread is the uncertainty estimate: at this sample size a 0.02 PR-AUC
    difference between two models is noise, and reporting mean +/- sd makes
    that visible rather than hiding it behind a single number.
    """
    keys = [k for k in fold_metrics[0] if k not in ("n", "tn", "fp", "fn", "tp")]
    out = {}
    for key in keys:
        values = np.array([m[key] for m in fold_metrics], dtype=float)
        out[f"{key}_mean"] = float(np.nanmean(values))
        out[f"{key}_sd"] = float(np.nanstd(values, ddof=1)) if len(values) > 1 else 0.0
    out["n_total"] = int(sum(m["n"] for m in fold_metrics))
    return out
