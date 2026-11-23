---
title: Glossary
summary: Plain definitions of the terms used across EthioFoodCast.
---

Terms used in the app and in these articles, in alphabetical order.

## Accuracy

The share of households the model classified correctly, counting both the food-insecure households it flagged and the food-secure households it did not.

## Dependency ratio

Children (under 15) and elderly members (65 or older) divided by working-age members (15–64). A ratio of 2 means two dependants for every working-age adult. The app calculates it from the household questions.

## Ensemble

Several models trained separately whose scores are averaged. EthioFoodCast averages five graph neural networks, which makes scores steadier.

## Follow-up cut-off

The score above which a household is flagged for a visit: {{threshold}}. It was chosen during testing and is a planning line, not a line between need and no need.

## Food Insecurity Experience Scale (FIES)

A set of eight yes-or-no survey questions about difficulties getting enough food, developed by the Food and Agriculture Organization (FAO). EthioFoodCast uses the six more serious questions to define food insecurity.

## Graph neural network

A type of machine-learning model that learns from a network of connected items. Here, households are connected to their survey area and areas to their nearest neighbours, so each score reflects both the household and its surroundings.

## Household profile

One of five groups of households with similar answers, such as "Typical smallholder" or "Irrigated". Profiles describe a household; they are not a risk score.

## Livestock units (TLU)

Tropical livestock units put different animals on one scale: on average a head of cattle counts 0.6, a sheep or goat 0.1 and a chicken 0.01. The app calculates them from the animal counts.

## LSMS

The World Bank's Living Standards Measurement Study, which supports national household surveys such as the Ethiopia Socioeconomic Survey that this project uses.

## NDVI

The Normalized Difference Vegetation Index: a satellite measure of how green and dense vegetation is. It is used as an indicator of crop and pasture conditions in each survey area.

## Precision

Of the households flagged for a visit, the share that were actually food insecure.

## Productive Safety Net Programme (PSNP)

Ethiopia's national social protection programme, which provides food or cash to chronically food-insecure households, usually in return for work on community projects. One interview question asks whether the household takes part.

## Recall

Of the households that were actually food insecure, the share the model flagged. Higher recall means fewer households in need are missed.

## Risk band

A word summarising a score: Low (below 0.45), Moderate (0.45 to 0.70) or High (0.70 and above).

## ROC AUC

A measure of how well scores rank households, regardless of the cut-off. 0.5 is no better than chance and 1 is a perfect ranking.

## Survey area

A small group of neighbouring households visited together by the survey team, also called an enumeration area. Each household in the app belongs to one of {{training_areas}} survey areas.

## Test households

Households set aside before training and used only to measure how well the model works. EthioFoodCast's figures come from {{test_households}} test households.

## Timad

A traditional Ethiopian unit of land, roughly the area a pair of oxen can plough in a day; about 2,500 square metres, or a quarter of a hectare.

## Zone and woreda

Ethiopia's administrative levels below the region. A region is divided into zones, and zones into woredas (districts).
