# Peoria Disc Golf

A static site (no build step) covering 23 disc golf courses in the Greater Peoria, Illinois area. It includes filtering and sorting, a live map, course detail pages, and live weather.

## Development

This site was created to test the capabilities of Claude Opus 5.5, prompted with:

> Create a website that provides details for the Disc Golf courses in the greater Peoria Illinois area. The final product should offer a browser with sorting/filtering for the different courses, and choosing a course should provide helpful information regarding its location, difficulty, price, operating hours, as well as any other details that can be retrieved through APIs or public sources. In addition to this functionality, the site should be beautiful & stylized; use clever web tricks to implement a site that impresses any visitor that interacts with it. Prepare this repo for hosting on GitHub Pages so it can be accessed publicly.

Claude Opus 5.5, Extra High reasoning, 872K context size  
Ran for 36 minutes in VS Code GitHub Copilot, 847.1 credits

## Run locally

ES modules need an HTTP server, so opening the file directly won't work:

```sh
python -m http.server 8000
# then open http://localhost:8000
```

## Data

Course data lives in `js/courses.js`. It was compiled from the PDGA Course Directory, OpenStreetMap, and park district and operator websites. Hours without an official source are flagged as unverified in the UI. At runtime, weather comes from [Open-Meteo](https://open-meteo.com/), map tiles from OpenStreetMap, and sunrise/sunset times are calculated in the browser.
