---
title: EthioFoodCast API
emoji: 🌾
colorFrom: blue
colorTo: yellow
sdk: docker
app_port: 5000
pinned: false
short_description: Household food-insecurity forecasting API for Ethiopia
---

# EthioFoodCast API

The scoring service behind EthioFoodCast: a FastAPI app over a graph neural network
ensemble that ranks Ethiopian farming households by their risk of food insecurity, from a
14-question interview and the area where the household was surveyed.

- Interactive API documentation: `/docs`
- Health check: `/api/health`
- Score one household: `POST /api/predict`

Scores rank households for a human follow-up assessment. They are not eligibility
decisions. No raw survey data, household identifiers or coordinates are included.

This Space is published from the project repository with `scripts/publish_hf_space.sh`;
edit the code there, not here.
