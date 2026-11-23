---
title: Accuracy and limits
summary: How the model was tested, how often it is right, how it compares with other approaches, and where it should not be trusted.
---

The model was tested on households it never saw during training, against what those households actually reported in 2021/22.

## How it was tested

In every survey area, every fourth household was set aside before training. The model was trained on the rest and scored the set-aside households once. This was repeated with five different sets of held-out households to check that the results were not a matter of luck.

## Results

| Measure | Main test ({{test_households}} households) | Average of five tests |
|---|---|---|
| Accuracy: share of households classified correctly | {{accuracy}} | {{cv_accuracy}} (± {{cv_accuracy_sd}} points) |
| Recall: share of food-insecure households flagged | {{recall}} | {{cv_recall}} |
| Precision: share of flagged households that were food insecure | {{precision}} | {{cv_precision}} |
| ROC AUC: how well scores rank households (0.5 is chance, 1 is perfect) | {{roc_auc}} | {{cv_roc_auc}} |

For context, **{{baseline_rate}}** of test households were food insecure, so simply calling every household food insecure would be right {{baseline_rate}} of the time but could not tell households apart.

## Right and wrong calls

On the main test, with households above the {{threshold}} cut-off flagged:

- **{{tp}}** food-insecure households were correctly flagged.
- **{{fn}}** food-insecure households were missed.
- **{{fp}}** food-secure households were flagged unnecessarily.
- **{{tn}}** food-secure households were correctly not flagged.

The two kinds of error have different costs. A miss means a household in need is not visited; an unnecessary flag means a visit finds no problem. The cut-off balances the two, and the planning page shows what changes when more or fewer households are visited.

## Comparison with other approaches

The graph neural network was compared with three common alternatives, all given the same inputs, including summaries of neighbouring areas. This comparison used a wider set of inputs than the 14-question interview, so its figures differ slightly from those above.

| Model | Accuracy |
|---|---|
| Graph neural network | {{model_gcn}} |
| Extra trees with neighbouring areas | {{model_extratrees}} |
| LightGBM with neighbouring areas | {{model_lightgbm}} |
| Logistic regression with neighbouring areas | {{model_logistic}} |

A benchmark form that also asks about the household's recent diet scored {{benchmark_accuracy}} against {{cv_accuracy}} for the 14 farming questions. The difference is not statistically significant. The farming form was chosen by a rule set before the results were known: at least 75% accuracy on every test and recall close to the benchmark.

## Unanswered questions

Interviews are often incomplete, so the app was tested with answers removed at random. With one in five answers left as "Unknown", **{{missing20_scored}}** of households could still be scored and accuracy stayed at **{{missing20_accuracy}}**. With three in ten missing, only **{{missing30_scored}}** had the {{min_answers}} answers needed.

## Known limits

- **The data is from 2018/19 to 2021/22.** Drought, conflict, prices and the COVID-19 pandemic have changed conditions since then. Scores describe past patterns, not the current situation.
- **Farming households only.** The model has not been tested on urban, pastoralist or non-farming households.
- **The survey area matters most.** Choosing the wrong area, or an area whose name is only approximate, can change a score substantially.
- **Some regions have little or no data.** Tigray and Addis Ababa have no test households, and Somali and Benishangul-Gumuz have very few.
- **Self-reported outcomes.** Food insecurity is measured by what households said in an interview, which can be affected by recall and by how questions were understood.
- **Reasons are not causes.** The factors shown with a score explain the model's calculation, not why a household is struggling.
