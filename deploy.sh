#!/bin/bash

# Build the project
npm run build

# Navigate into the build output directory
cd dist

# Create a new git repository in the dist folder
git init
git add -A
git commit -m 'Deploy to GitHub Pages'

# Push to gh-pages branch
git push -f https://github.com/Misaru-Maya/ora.git main:gh-pages

cd -
