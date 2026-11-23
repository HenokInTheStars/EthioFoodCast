---
title: The data behind the model
summary: Which surveys the model learned from, which households are included, and how food insecurity is measured.
---

The model learned from two rounds of a national household survey that visited the same households twice, three years apart. That lets it learn how a household's situation in one year relates to its food security later.

## The surveys

The data comes from the **Ethiopia Socioeconomic Survey 2018/19** and the **Ethiopia Socioeconomic Panel Survey 2021/22**. Both are run by the Ethiopian Statistics Service with the World Bank's Living Standards Measurement Study (LSMS). They interview households across the country about their members, farming, livestock, income, assets and food.

The model uses each household's answers from 2018/19 to predict whether the same household reported food insecurity in 2021/22.

## Which households are included

Only **farming households** interviewed in both rounds are used, because the interview questions are about land, crops and livestock.

- The model was trained on **{{training_households}} households** in **{{training_areas}} survey areas**.
- It was tested on **{{test_households}} households** it had never seen. In 2021/22, **{{baseline_rate}}** of them reported food insecurity.

Tigray and Addis Ababa have no test households, and Somali and Benishangul-Gumuz have too few to report safely, so regional figures leave them out. A region without a figure does not have zero risk.

## How food insecurity is measured

In 2021/22 every household answered eight questions from the Food Insecurity Experience Scale (FIES), each a simple yes or no about the past year. In this project a household counts as **food insecure** if it reported any of the six more serious experiences:

- ate only a few kinds of food
- had to skip a meal
- ate less than it thought it should
- ran out of food
- was hungry but did not eat
- went without eating for a whole day

The two milder questions (worrying about food, and being unable to eat healthy food) are not counted. One question, going a whole day without eating, asks about the last 30 days instead of the last 12 months; this is how the survey asked it.

Unanswered questions are never filled in. If a household's missing answers could change its result, the household is left out rather than guessed. This is a survey-based measure for this project, not an official FAO prevalence estimate, which needs an extra calibration step.

## Survey area information

Each household belongs to a survey area: a small group of neighbouring households visited together. For every area the model also uses the **rainfall** and **vegetation (NDVI)** recorded by satellite in 2018 and 2019.

The survey moves each area's published location by up to 5 km to protect respondents. Area names in the app come from official administrative boundaries matched to those locations. Zone names are confirmed for **{{zone_verified}}** of areas and woreda names for **{{woreda_verified}}**; the others are marked "(approx.)".

## Privacy

The app contains no raw survey data, no household identifiers and no coordinates. Everything shown is a summary of the test households, and regions with too few households are not reported.
