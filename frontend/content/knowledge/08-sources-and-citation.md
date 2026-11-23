---
title: Data sources and how to cite
summary: The surveys, satellite data and boundaries EthioFoodCast is built on, their terms of use, and how to cite the project.
---

EthioFoodCast is built entirely on public data. This article credits each source, explains the terms the data comes with, and gives a citation for anyone who refers to the project in a report, paper or application.

## Household surveys

The model learned from two rounds of Ethiopia's national household panel, run by the country's statistics office with the World Bank's Living Standards Measurement Study – Integrated Surveys on Agriculture (LSMS-ISA). Both are published as public use files in the World Bank Microdata Library.

| Survey | Producer | Reference |
|---|---|---|
| [Ethiopia Socioeconomic Survey 2018-2019 (ESS4)](https://microdata.worldbank.org/index.php/catalog/3823) | Central Statistics Agency of Ethiopia, with the World Bank | ETH_2018_ESS_v04_M |
| [Ethiopia Socio-Economic Panel Survey 2021-2022, Wave 5 (ESPS-5)](https://microdata.worldbank.org/index.php/catalog/6161) | Ethiopian Statistical Service, with the World Bank and the National Bank of Ethiopia | ETH_2021_ESPS-W5_v03_M |

The Central Statistics Agency is now called the Ethiopian Statistical Service, which is why the two surveys name different producers. The references are the current versions listed in the Microdata Library.

## Satellite and location data

The rainfall and vegetation (NDVI) figures for each survey area are the geospatial variables published with the surveys themselves, which the survey team derives from satellite records. To protect respondents, the survey moves each area's published location by up to 5 km, and EthioFoodCast never shows these locations.

## Maps and place names

- **Zone and woreda names** come from the [OCHA administrative boundaries for Ethiopia](https://data.humdata.org/dataset/cod-ab-eth), published on the Humanitarian Data Exchange, matched to the survey areas' displaced locations. See [The data behind the model](/knowledge/data#survey-area-information) for how many names are confirmed.
- **The regional map** uses simplified [geoBoundaries](https://www.geoboundaries.org/) Ethiopia first-level boundaries (2016), sourced from Open Africa and Code for Ethiopia and licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Boundaries are shown for reference only and do not imply any position on the status of any territory or border.

## Terms of use and licences

The survey files are public use files, free to use for research with acknowledgement of the producers. EthioFoodCast does not redistribute them: the app contains only summaries of the test households, with no raw survey records, identifiers or coordinates.

The producers and distributors of the data bear no responsibility for how it is used here, or for any interpretation or conclusion drawn from it. EthioFoodCast is an independent project and is not endorsed by the Ethiopian Statistical Service, the World Bank or any other organisation named on this page.

## How to cite EthioFoodCast

If you refer to EthioFoodCast, please cite it as:

> Solomon, H., Debesay, N., & Aman, A. (2026). *EthioFoodCast: household food-insecurity risk ranking for Ethiopia* [Web application].

Add the address of the website you used and the date you accessed it. A copyable version, with BibTeX, is on the [Knowledge centre](/knowledge#cite) page.

If you use the underlying data, cite the surveys as their producers request:

> Central Statistical Agency of Ethiopia. Ethiopia Socioeconomic Survey (ESS4) 2018-2019. Public Use Dataset. Ref: ETH_2018_ESS_v04_M. Downloaded from https://microdata.worldbank.org/index.php/catalog/3823 on [date].

> Ethiopian Statistical Service. Ethiopia Socioeconomic Panel Survey, Wave 5 (ESPS-5) 2021-2022. Public Use Dataset. Ref: ETH_2021_ESPS-W5_v03_M. Downloaded from https://microdata.worldbank.org/index.php/catalog/6161 on [date].
