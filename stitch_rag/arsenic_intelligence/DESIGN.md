---
name: Arsenic Intelligence
colors:
  surface: '#faf9fd'
  surface-dim: '#dad9dd'
  surface-bright: '#faf9fd'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f3f7'
  surface-container: '#efedf1'
  surface-container-high: '#e9e7eb'
  surface-container-highest: '#e3e2e6'
  on-surface: '#1a1c1e'
  on-surface-variant: '#43474e'
  inverse-surface: '#2f3033'
  inverse-on-surface: '#f1f0f4'
  outline: '#74777f'
  outline-variant: '#c4c6cf'
  surface-tint: '#455f88'
  primary: '#002045'
  on-primary: '#ffffff'
  primary-container: '#1a365d'
  on-primary-container: '#86a0cd'
  inverse-primary: '#adc7f7'
  secondary: '#595f63'
  on-secondary: '#ffffff'
  secondary-container: '#dbe0e5'
  on-secondary-container: '#5e6368'
  tertiary: '#321b00'
  on-tertiary: '#ffffff'
  tertiary-container: '#4f2e00'
  on-tertiary-container: '#c6955e'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d6e3ff'
  primary-fixed-dim: '#adc7f7'
  on-primary-fixed: '#001b3c'
  on-primary-fixed-variant: '#2d476f'
  secondary-fixed: '#dee3e8'
  secondary-fixed-dim: '#c2c7cc'
  on-secondary-fixed: '#171c20'
  on-secondary-fixed-variant: '#42474c'
  tertiary-fixed: '#ffddba'
  tertiary-fixed-dim: '#f2bc82'
  on-tertiary-fixed: '#2b1700'
  on-tertiary-fixed-variant: '#633f0f'
  background: '#faf9fd'
  on-background: '#1a1c1e'
  surface-variant: '#e3e2e6'
typography:
  h1:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  h2:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  h3:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '500'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  container-padding: 24px
  gutter: 16px
---

## Brand & Style

The design system is engineered for a high-precision scientific assistant, balancing technical authority with cognitive ease. The brand personality is **analytical, reliable, and sophisticated**, designed to instill confidence in researchers and scientists handling complex data.

The UI follows a **Modern Corporate** aesthetic with a strong emphasis on **Minimalism**. It utilizes expansive white space to reduce cognitive load during intense data analysis. The interface avoids unnecessary decoration, focusing instead on structural clarity and a clear hierarchy of information. The emotional response is one of "calm competence"—the tool feels like a quiet, high-performance laboratory environment where the data is the hero.

## Colors

The color palette is grounded in stability and scientific rigor. 

- **Primary Deep Blue (#1A365D):** Used for primary actions, navigation headers, and text density to establish authority.
- **Secondary Light Blue-Grey (#EDF2F7):** Acts as a structural neutral for grouping content and separating sections without the harshness of high-contrast borders.
- **Accent Caution Orange (#F6AD55 / #DD6B20):** A dual-tone system for risk management. The lighter tint is for cautionary warnings, while the deeper tone is reserved for high-priority emphasis or critical alerts.
- **Toxicity Background:** A very pale orange wash is used behind risk-related alerts to create a distinct visual zone that alerts the user without causing alarmist fatigue.

## Typography

This design system utilizes **Inter** for its exceptional legibility in data-heavy environments. The typographic scale is optimized for information density:

- **Headings:** Start at 18px to ensure they stand out as structural anchors. Weight is increased for H1 and H2 to provide a clear entry point into pages.
- **Body Copy:** Fixed at 14px to allow for high information density while maintaining readability.
- **Captions & Labels:** 12px is used for metadata, units of measurement, and supporting information.
- **Mathematical Integrity:** Ensure all numerical data is set with tabular lining figures to maintain alignment in tables and reports.

## Layout & Spacing

This design system employs a **Fixed Grid** approach for desktop dashboards and a **Fluid Grid** for mobile views. 

- **The 8px Rhythm:** All padding, margins, and heights are derived from a 4px base unit, generally scaling in 8px increments.
- **White Space:** Generous margins (24px+) are mandated around major card groups to prevent the "cluttered laboratory" feel.
- **Structure:** Content is organized into a 12-column grid. Sidebars are fixed at 280px, with the main content area expanding to fill the remainder up to a max-width of 1440px.

## Elevation & Depth

Hierarchy is established through **Ambient Shadows** and **Tonal Layers** rather than heavy lines.

- **Level 0 (Surface):** Background White (#FFFFFF).
- **Level 1 (Cards):** Secondary Light Blue-Grey (#EDF2F7) or White with a 1px #E2E8F0 border.
- **Level 2 (Active States):** Soft, diffused shadows (0px 4px 12px rgba(26, 54, 93, 0.08)). These shadows use a hint of the Primary Deep Blue to keep the depth feeling "cool" and integrated.
- **Level 3 (Modals/Popovers):** Deeper shadows (0px 12px 24px rgba(26, 54, 93, 0.12)) to indicate high-priority interaction.

## Shapes

The design system uses a **Rounded** shape language to soften the clinical nature of scientific data.

- **Standard Cards:** 12px to 16px radius.
- **Buttons & Inputs:** 8px radius.
- **Alerts/Banners:** 12px radius.
- **Icons:** Thin-line (1.5px stroke) or duotone styles. Duotone icons should use Primary Deep Blue for the main path and Secondary Light Blue-Grey for the accent fill to maintain a tech-oriented look.

## Components

- **Buttons:** Primary buttons use the Deep Blue fill with white text. Secondary buttons use the Light Blue-Grey fill with Deep Blue text. Emphasis actions use the Caution Orange (#DD6B20).
- **Cards:** The primary container for data. Always features a 12-16px radius and a subtle shadow or 1px light border. Header sections within cards should be separated by a light grey divider.
- **Toxicity Alerts:** Specialized banners with a background of #FFFAF0 and a left-accent border of #F6AD55. Use a "Warning" duotone icon.
- **Input Fields:** Clean 8px rounded boxes with #EDF2F7 backgrounds that transition to a White background with a Deep Blue border on focus.
- **Chips/Tags:** Used for scientific categories. Small 12px text, 4px radius, using Light Blue-Grey as the base and Deep Blue for active selections.
- **Data Visualizations:** Charts should utilize a palette derived from the Primary Blue and Accent Orange, ensuring high contrast for accessibility.