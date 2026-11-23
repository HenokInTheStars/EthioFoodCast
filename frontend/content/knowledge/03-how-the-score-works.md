---
title: How the risk score works
summary: The interview questions, the survey area, the model, and how a score becomes a risk band and a follow-up prompt.
---

A score combines two things: what the household tells you in the interview, and what the model learned about its survey area and the areas around it.

## The interview questions

The interview has 14 questions in four groups. At least **{{min_answers}}** must be answered for a score; "Unknown" is a valid answer.

| Group | Questions |
|---|---|
| Household | Children under 15, members aged 15–64, members aged 65 or older |
| Land and crops | Land farmed, any irrigated field, number of crops planted, any crop damage, any harvest shortfall |
| Livestock | Cattle, sheep and goats, chickens owned 12 months ago |
| Livelihood | A business outside farming, taking part in the Productive Safety Net Programme, number of household assets |

## What the app calculates

Some useful measures are worked out from the answers so the interviewer does not have to: household size, the dependency ratio (children and elderly per working-age member), livestock units, and land and livestock per person.

## The survey area

The interviewer also chooses the survey area the household belongs to. The area brings in its rainfall and vegetation and, more importantly, what the model learned from other households surveyed there and in nearby areas.

The area is the single biggest influence on a score. Leaving it out changes a test household's score by **{{area_effect}}** on average, far more than any one answer. Two similar households in different areas can therefore get quite different scores.

## The model

The model is a **graph neural network**. It treats households and survey areas as a network: each household is linked to its area, and each area to its nearest neighbours. Information passes along those links, so a household's score reflects both its own answers and the situation around it.

Five copies of the model were trained from different random starting points and their scores are averaged. This kind of **ensemble** gives steadier scores than any single model.

## From score to risk band

The score is between 0 and 1. A higher score means the household looks more like the households that reported food insecurity in 2021/22.

| Band | Score |
|---|---|
| Low | below 0.45 |
| Moderate | 0.45 to 0.70 |
| High | 0.70 and above |

Separately, households scoring above the **follow-up cut-off of {{threshold}}** are flagged for a visit. The cut-off was chosen during testing to find most food-insecure households without flagging too many others. A Moderate household can be above the cut-off.

## The reasons shown with a score

Each score comes with the answers that moved it most. They are found by withholding each answer in turn and measuring how much the score changes. They describe how the model reached the score, **not what causes** a household's hardship.

## Household profiles

Households are also grouped into five profiles from their answers: Typical smallholder, Land-rich / Diversified-cropping, Irrigated, Livestock-holding / Market-isolated, and Better-off / Diverse-diet. Profiles help describe a household in familiar terms; they are not a second risk score.

## Follow-up prompts

A short list of fixed rules suggests what to check during the visit. For example, reported crop damage prompts a check of the harvest and food stocks, no irrigated field prompts a look at water access, and very few animals prompts a livestock assessment. These rules are written by people and can be changed without retraining the model. They are prompts for a conversation, not conclusions.
