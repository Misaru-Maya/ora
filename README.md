# ORA - Open Research Analytics

A React-based data visualization tool for analyzing survey and research data with statistical significance testing.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run tests
npm test

# Build for production
npm run build

# Deploy to production
npm run deploy
```

## 📋 Features

- **CSV Data Import** - Upload and parse survey data from CSV files
- **Dynamic Segmentation** - Analyze data across multiple demographic segments
- **Statistical Significance** - Chi-square testing for group comparisons
- **Multiple Chart Types** - Bar charts, pie charts, stacked charts, and heatmaps
- **Interactive Filtering** - Filter by answer options, segments, and statistical significance
- **Product Testing Support** - Special handling for product-level vs respondent-level data
- **Export & Sharing** - Download charts as images

## 📁 Project Structure

```
ora-slc/
├── src/
│   ├── components/           # React components
│   │   ├── ChartGallery.tsx # Main chart gallery container
│   │   ├── ComparisonChart.tsx # Bar/stacked chart component
│   │   ├── SingleSelectPieChart.tsx # Pie chart component
│   │   ├── HeatmapTable.tsx # Heatmap visualization
│   │   └── CSVUpload.tsx    # CSV file upload component
│   │
│   ├── dataCalculations.ts  # Core statistical calculations
│   ├── csvParser.ts         # CSV parsing and question detection
│   ├── chartConfig.ts       # Recharts configuration
│   ├── store.ts             # Zustand state management
│   ├── types.ts             # TypeScript type definitions
│   └── App.tsx              # Main application component
│
├── MATH_DOCUMENTATION.md    # Detailed statistical documentation
├── vitest.config.ts         # Test configuration
└── README.md                # This file
```

## 🧮 Core Calculations

### Statistical Significance (Chi-Square Test)

The app performs chi-square tests to determine if differences between groups are statistically significant:

```typescript
χ² = [N(ad - bc)²] / [(a+b)(c+d)(a+c)(b+d)]
```

- **Critical Value**: 3.841 (95% confidence, df=1)
- **Significant**: χ² ≥ 3.841
- **See**: `MATH_DOCUMENTATION.md` for full details

### Percentage Calculations

```typescript
percentage = (count / denominator) × 100
```

**Important**: For multi-select questions, denominator = respondents who selected ANY option in that question (not total respondents).

### Respondent vs Row-Level Counting

- **Respondent-level**: Counts unique respondent IDs (survey questions)
- **Row-level**: Counts all rows (product testing - same person evaluates multiple products)

## 🛠️ Technology Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Zustand** - State management
- **Recharts** - Chart library
- **TailwindCSS** - Styling
- **Vitest** - Testing framework
- **PapaParse** - CSV parsing

## 🧪 Testing

### Run Tests

```bash
# Run all tests
npm test

# Run tests in UI mode
npm run test:ui

# Run tests once (CI mode)
npm run test:run

# Run with coverage
npm run test:coverage
```

### Test Coverage

Tests cover:
- ✅ Chi-square statistical calculations
- ✅ Percentage calculations and rounding
- ✅ Respondent vs row-level counting logic
- ✅ Overall segment handling
- ✅ Edge cases (zero denominators, empty data)

## 📊 Usage Guide

### 1. Upload CSV Data

Your CSV should have:
- **Respondent ID column** (e.g., "Respondent ID", "respondent_id")
- **Segment columns** (e.g., "Age", "Gender", "Region")
- **Question columns** with markers:
  - `(multi)` - Multi-select questions
  - `(single)` - Single-select questions
  - `(scale)` - Scale/rating questions

**Example CSV structure:**
```csv
Respondent ID,Age,Gender,Q1_Quality (multi),Q1_Price (multi),Q2_Overall (single)
R001,25-34,Male,1,0,Very Satisfied
R002,35-44,Female,0,1,Satisfied
```

### 2. Select Segmentation

- Choose a segment column (Age, Gender, etc.)
- Select specific groups to compare
- Optionally include "Overall" for aggregate data

### 3. View Results

- Charts display percentages for each group
- `*` indicates statistically significant differences
- Use filters to focus on specific options or significant results only

### 4. Export

- Download individual charts as PNG images
- Use for reports and presentations

## ⚠️ Known Limitations

See `MATH_DOCUMENTATION.md` for full details. Key limitations:

1. **No Yates' Continuity Correction** - May overestimate significance for small samples
2. **Multiple Comparison Problem** - No Bonferroni correction applied
3. **Fixed Confidence Level** - Always uses 95% (α = 0.05)
4. **No Sample Size Validation** - Doesn't check if expected frequencies ≥ 5

## 🔬 For Statistical Review

**Statisticians and data scientists should review:**

1. **MATH_DOCUMENTATION.md** - Full mathematical specifications
2. **src/dataCalculations.ts:362-392** - Chi-square implementation
3. **src/dataCalculations.test.ts** - Test cases with known outcomes

**Questions to validate:**
- Is the chi-square formula implemented correctly?
- Should we use Yates' correction for small samples?
- Do we need multiple comparison correction (Bonferroni)?
- Are there edge cases not covered by tests?

## 📝 Code Quality Checklist

### ✅ Completed
- [x] Manual testing by user
- [x] Basic automated tests for calculations
- [x] Math/statistical documentation
- [x] Edge case handling (null values, empty data)

### ⏳ Pending Review
- [ ] Code review by engineer
- [ ] Statistical validation by data scientist
- [ ] Performance testing with large datasets
- [ ] Security audit (if handling sensitive data)
- [ ] Accessibility audit (WCAG compliance)

## 🚀 Deployment

### Vercel (Current)

```bash
npm run deploy
```

Automatically builds and deploys to Vercel.

### Manual Deployment

```bash
# Build static files
npm run build

# Files will be in dist/
# Upload to any static hosting service
```

## 🐛 Troubleshooting

### Tests Failing

```bash
# Clean install
rm -rf node_modules package-lock.json
npm install

# Run tests
npm test
```

### Build Errors

```bash
# Check TypeScript
npx tsc --noEmit

# Clean build
rm -rf dist
npm run build
```

### Development Server Issues

```bash
# Kill existing process
lsof -ti:5173 | xargs kill -9

# Restart
npm run dev
```

## 📚 Additional Documentation

- **MATH_DOCUMENTATION.md** - Detailed mathematical specifications for technical review
- **src/types.ts** - TypeScript interfaces and type definitions
- **vitest.config.ts** - Test configuration

## 🤝 Contributing

When adding features:

1. **Write tests first** - Add test cases to `*.test.ts` files
2. **Update documentation** - Keep README and MATH_DOCUMENTATION.md in sync
3. **Run tests** - Ensure `npm test` passes
4. **Check types** - Run `npx tsc --noEmit`

## 📄 License

Private - Internal Use Only

## 📧 Contact

For questions about:
- **Statistical calculations** - Contact Frank (CTO)
- **Feature requests** - Contact Misaki
- **Technical issues** - Check GitHub issues

---

**Built with Claude Code** 🤖
