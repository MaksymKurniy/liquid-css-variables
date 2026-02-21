# Liquid CSS Variables - IntelliSense for Shopify

Smart CSS variable autocompletion for Shopify Liquid themes in VS Code. Extract and autocomplete CSS custom properties from your Liquid files with full Shopify settings integration.

## ✨ Features

- 🎯 **Smart Autocompletion** - Autocomplete CSS variables from `{% style %}` blocks in Liquid files
- 🔍 **Deep Parsing** - Extracts all CSS custom properties from `:root` sections (including nested `@media` queries)
- 💡 **Hover Information** - See variable values, source files, and conversions on hover
- 🔗 **Quick Navigation** - Click source file links in hover tooltips to jump to definitions
- ⚙️ **Shopify Integration** - Converts Liquid variables `{{ settings.* }}` to actual values from `config/settings_data.json`
- 🎨 **Full Liquid Support** - Handles complex Liquid syntax: loops, conditionals, filters, and more
- 🔢 **rem↔px Conversion** - Automatic unit conversion hints in tooltips
- ⚡ **High Performance** - Optimized with caching for large projects
- 🔄 **Auto-refresh** - Automatically updates when Liquid or config files change
- 📝 **Multi-language Support** - Works in CSS, SCSS, LESS, HTML, and Liquid files

## 🚀 Quick Start

1. Open a Shopify theme project with Liquid files
2. Extension automatically scans all `.liquid` files
3. Start typing `--` or `var(--` in CSS/SCSS/Liquid files
4. Press `Ctrl+Space` to trigger autocompletion
5. Hover over variables to see details and click source links

## 📖 Examples

### Basic Example

If you have a file `snippets/variables.liquid`:

```liquid
{% style %}
:root {
  --color-primary: #3498db;
  --color-secondary: #2ecc71;
  --font-size-base: 16px;
  
  @media (min-width: 768px) {
    --font-size-base: 18px;
  }
}
{% endstyle %}
```

### Shopify Settings Integration

The extension automatically converts Liquid variables to actual values:

```liquid
{% style %}
:root {
  --button-radius: {{ settings.button_border_radius_primary }}px;
  --input-radius: {{ settings.inputs_border_radius }}px;
  --opacity: {{ settings.opacity_value }}%;
}
{% endstyle %}
```

If your `config/settings_data.json` contains:
```json
{
  "current": {
    "button_border_radius_primary": 14,
    "inputs_border_radius": 4,
    "opacity_value": 50
  }
}
```

You'll see autocompletion with:
- `--button-radius` → `14px` (value: 14, unit: px from template)
- `--input-radius` → `4px` (value: 4, unit: px from template)
- `--opacity` → `50%` (value: 50, unit: % from template)

### Using in CSS

Now in any CSS/SCSS file:

```css
.button {
  background: var(--color-primary); /* Autocompletion works! */
  font-size: var(--font-size-base);
  border-radius: var(--button-radius);
}

/* Hover over any variable to see:
   - Current value
   - Source file (clickable link)
   - Media query variants
   - rem↔px conversion
*/
```

### Hover Tooltips

Hover over any CSS variable to see detailed information:

```css
.container {
  padding: var(--spacing-lg);
  /* Hover shows:
     CSS Variable: --spacing-lg
     Value: 2rem
     Source: variables.liquid (clickable link!)
     Convert to px: 32px
  */
}
```

### rem↔px Conversion

Automatic conversion hints in both autocompletion and hover:

```css
/* Variable: --spacing-lg: 2rem */
.container {
  padding: var(--spacing-lg); 
  /* Shows: 2rem → 32px */
}

/* Variable: --input-height: 48px */
input {
  height: var(--input-height);
  /* Shows: 48px → 3rem */
}
```

## 🎮 Commands

- **Liquid CSS Variables: Refresh** - Manually scan all Liquid files for CSS variables
  - Command Palette: `Ctrl+Shift+P` → "Liquid CSS Variables: Refresh"
  - Shows: "✓ Found X CSS variables from Y Liquid file(s)"

## ⚡ Performance Optimization

For large projects, limit scanning to files containing CSS variables:

```json
{
  "liquidCssVariables.includePatterns": [
    "**/snippets/theme-styles-*.liquid",
    "**/snippets/variables.liquid",
    "**/sections/header.liquid"
  ],
  "liquidCssVariables.excludePatterns": [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**"
  ]
}
```

**Performance Tips:**
- ✅ Use specific patterns instead of `**/*.liquid`
- ✅ Exclude unnecessary directories
- ✅ Extension uses smart caching (hex colors, settings lookups)
- ✅ Early file skipping if no `:root` blocks found
- ✅ Parallel file processing for faster scans

## ⚙️ Configuration

### `liquidCssVariables.includePatterns`
Array of glob patterns to search for Liquid files.

**Default:** `["**/*.liquid"]`

**Example (snippets and sections only):**
```json
{
  "liquidCssVariables.includePatterns": [
    "**/snippets/**/*.liquid",
    "**/sections/**/*.liquid"
  ]
}
```

### `liquidCssVariables.excludePatterns`
Array of glob patterns to exclude files.

**Default:** `["**/node_modules/**"]`

### `liquidCssVariables.remToPxConversion`
Show rem↔px conversion in autocompletion and hover tooltips.

**Default:** `true`

### `liquidCssVariables.baseFontSize`
Base font size for rem↔px conversion.

**Default:** `16` (px)

### `liquidCssVariables.onlyRoot`
Only parse `:root` blocks (skip class-based variables like `.color-scheme-1`).

**Default:** `true`

**Example:**
```json
{
  "liquidCssVariables.remToPxConversion": true,
  "liquidCssVariables.baseFontSize": 16,
  "liquidCssVariables.onlyRoot": true
}
```

With these settings:
- `2rem` → shows `32px`
- `32px` → shows `2rem`
- Only variables in `:root { }` are indexed

## 🔧 How It Works

The extension searches for CSS variables in:
- `{% style %}...{% endstyle %}` blocks
- `{% stylesheet %}...{% endstylesheet %}` blocks
- `<style>...</style>` tags
- `:root { ... }` sections (including nested `@media` queries)
- `.class-name { ... }` blocks (when `onlyRoot` is `false`)
- All files with `.liquid` extension

**Shopify Theme Support:**
- Reads `config/settings_data.json` for current values
- Reads `config/settings_schema.json` for default values
- Converts Liquid variables `{{ settings.* }}` to actual values
- Preserves units (`px`, `%`, `rem`, etc.) from Liquid templates
- Processes complex Liquid syntax:
  - `{% liquid %}` blocks with multiple commands
  - `{% for %}` loops (takes first iteration)
  - `{% if %}`, `{% elsif %}`, `{% else %}` conditionals
  - Liquid filters: `split`, `replace`, `append`, `times`, `divided_by`, etc.
  - Dynamic property access: `settings[variable]`, `object.property`
- Auto-refreshes when config files change

**Advanced Features:**
- **Smart caching** - Hex→RGBA conversions, settings lookups
- **Pre-compiled regex** - All patterns compiled once for speed
- **Parallel processing** - Multiple files scanned simultaneously
- **Early optimization** - Skips files without `:root` immediately
- **No duplicate dashes** - Typing `--` + selecting variable = correct result

## 💡 Tips & Tricks

1. **Quick Navigation**: Hover over a variable and click the source file link to jump to its definition
2. **Smart Typing**: Start typing `--` and extension handles it perfectly (no `---` duplication)
3. **Media Queries**: Hover shows all media query variants of a variable
4. **Performance**: Use specific include patterns for faster scans in large projects

## 🛠️ Requirements

- VS Code version 1.75.0 or newer
- Shopify theme structure (optional, for settings integration)

## 🐛 Known Issues

Report issues on [GitHub](https://github.com/MaksymKurniy/liquid-css-variables/issues)

## 📄 License

MIT License - feel free to use in your projects!

---

**Enjoy!** 🎉 If you find this extension helpful, please consider leaving a review.
