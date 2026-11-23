---
title: Frequently asked questions
summary: Short answers to the questions people ask most often.
---

Short answers, with links to the articles that explain more.

## Is this an official government or agency tool?

No. EthioFoodCast is an independent research project. It uses public survey data from the Ethiopian Statistics Service and the World Bank, but it is not endorsed by them or by any other organisation.

## Can a score decide who receives assistance?

No. A score only suggests which households to visit first. Decisions about support must be made by people after a proper assessment. See [Using the results responsibly](/knowledge/responsible-use).

## How accurate is it?

On {{test_households}} households it had never seen, the model classified {{accuracy}} correctly and flagged {{recall}} of the households that turned out to be food insecure. See [Accuracy and limits](/knowledge/accuracy-and-limits).

## Why does the survey area matter so much?

Households in the same area share rainfall, markets, prices and local shocks, and the model learned how strongly these shaped food security in 2021/22. Leaving the area out changes a score by {{area_effect}} on average, more than any single answer.

## A household's answers look fine. Why is its score high?

Most likely because of its survey area: in areas where many households reported food insecurity, even a household with good answers gets a higher score. The reasons listed with the score show which factors moved it most.

## What if I don't know an answer?

Choose "Unknown". The model estimates the missing value rather than treating it as zero. At least {{min_answers}} of the 14 questions must be answered for a score.

## Which survey areas can I choose?

Only the {{training_areas}} survey areas in the data, because the model has learned something about each of them. Households elsewhere cannot be scored with their own area.

## Is the data up to date?

No. The model describes the relationship between 2018/19 conditions and food insecurity in 2021/22. Use it to prioritise visits, and check current information, such as recent harvest and price reports, before drawing conclusions about today.

## Does it work without an internet connection?

Pages you have opened, including this knowledge centre, keep working offline. Scoring a household and asking the AI assistant need a connection.

## Where do the AI assistant's answers come from?

From these articles only. Your question is sent to an AI service (Groq), together with the most relevant sections, and every answer cites the sections it used. If the articles do not cover a question, the assistant says so.

## Who built EthioFoodCast?

Henok Solomon (data and frontend), Niyat Debesay (machine learning and backend) and Amina Aman (product and analytics). See [About EthioFoodCast](/knowledge/about).
