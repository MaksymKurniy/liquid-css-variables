const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

// Performance caches
let cssVariables = new Map(); // Stores variables: name -> value
let shopifySettings = null; // Cache for settings_data.json
let shopifySettingsSchema = null; // Cache for settings_schema.json
let cachedConfig = null; // Cache for extension config
const hexToRgbaCache = new Map(); // Cache for hex -> rgba conversions (significant speed boost)
const settingValueCache = new Map(); // Cache for setting value lookups (avoids repeated traversal)

// Pre-compiled regex patterns for performance (compiled once, reused everywhere)
const REGEX = Object.freeze({
  liquidBlock: /{%-?\s*liquid\s+([\s\S]*?)%}/gi,
  forScheme: /{%\s*for\s+(\w+)\s+in\s+settings\.color_schemes\s*-%}([\s\S]*?){%\s*endfor\s*%}/gi,
  assign: /{%\s*assign\s+[^%]+%}/g,
  ifBlock: /{%\s*if\s+[\w.]+\s*[<>=!]+\s*\d+\s*%}([\s\S]*?)(?:{%\s*else\s*%}[\s\S]*?)?{%\s*endif\s*%}/gi,
  schemeSettings: /\{\{\s*scheme\.settings\.([\w.]+)(?:\s*\|\s*append:\s*['"]([^'"]+)['"])?\s*\}\}/g,
  settings: /\{\{\s*settings\.([\w.]+)(?:\s*\|\s*append:\s*['"]([^'"]+)['"])?\s*\}\}/g,
  variable: /\{\{\s*([\w_]+)\s*\}\}/g,
  liquidTags: /{%[^%]*%}/g,
  liquidOutput: /\{\{[^}]*\}\}/g,
  cssVariable: /--([\w-]+)\s*:\s*([^;]+);/g,
  rootBlock: /:root\s*(?:,\s*[.#][\w-]+\s*)*\{/g,
  mediaQuery: /@media\s*([^{]+)\{/g,
  arrayAccess: /^([\w_]+)\[([^\]]+)\]$/,
  propAccess: /^([\w_]+)\.([\w_]+)$/,
  numericLiteral: /^\d+(\.\d+)?$/,
});

/**
 * Gets extension configuration (with caching)
 */
function getExtensionConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }
  const config = vscode.workspace.getConfiguration('liquidCssVariables');
  cachedConfig = {
    includePatterns: config.get('includePatterns', [
      '**/*.liquid',
      '**/snippets/theme-styles-*.liquid',
      '**/snippets/color-schemes.liquid',
    ]),
    excludePatterns: config.get('excludePatterns', ['**/node_modules/**']),
    remToPxConversion: config.get('remToPxConversion', true),
    baseFontSize: config.get('baseFontSize', 16),
    onlyRoot: config.get('onlyRoot', true),
  };
  return cachedConfig;
}

/**
 * Invalidates all caches
 */
function invalidateConfigCache() {
  cachedConfig = null;
  hexToRgbaCache.clear();
  settingValueCache.clear();
}

/**
 * Converts rem to px
 */
function remToPx(remValue, baseFontSize = 16) {
  const numValue = parseFloat(remValue);
  if (isNaN(numValue)) return null;
  return (numValue * baseFontSize).toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Converts px to rem
 */
function pxToRem(pxValue, baseFontSize = 16) {
  const numValue = parseFloat(pxValue);
  if (isNaN(numValue)) return null;
  return (numValue / baseFontSize).toFixed(4).replace(/\.?0+$/, '');
}

/**
 * Loads Shopify settings from config/settings_data.json
 */
async function loadShopifySettings() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return null;
  }

  for (const folder of workspaceFolders) {
    const settingsPath = path.join(folder.uri.fsPath, 'config', 'settings_data.json');

    try {
      if (fs.existsSync(settingsPath)) {
        const content = fs.readFileSync(settingsPath, 'utf8');
        // Remove comments from JSON
        const cleanContent = content.replace(/\/\*[\s\S]*?\*\//g, '');
        const data = JSON.parse(cleanContent);
        const settings = data.current || {};
        console.log(`✓ Loaded ${Object.keys(settings).length} settings from settings_data.json`);
        return settings;
      }
    } catch (error) {
      console.error('Error loading settings_data.json:', error);
    }
  }

  return null;
}

/**
 * Loads Shopify settings schema from config/settings_schema.json
 */
async function loadShopifySettingsSchema() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return null;
  }

  for (const folder of workspaceFolders) {
    const schemaPath = path.join(folder.uri.fsPath, 'config', 'settings_schema.json');

    try {
      if (fs.existsSync(schemaPath)) {
        const content = fs.readFileSync(schemaPath, 'utf8');
        const data = JSON.parse(content);

        // Create map id -> default value
        const defaultsMap = {};
        for (const section of data) {
          if (section.settings) {
            for (const setting of section.settings) {
              if (setting.id && setting.default !== undefined) {
                defaultsMap[setting.id] = setting.default;
              }
            }
          }
        }

        console.log(`✓ Loaded ${Object.keys(defaultsMap).length} defaults from settings_schema.json`);

        return defaultsMap;
      }
    } catch (error) {
      console.error('Error loading settings_schema.json:', error);
    }
  }

  return null;
}

/**
 * Converts hex color to rgba format (with caching)
 */
function hexToRgba(hex, alpha = 1) {
  if (!hex || typeof hex !== 'string') return null;

  const cacheKey = `${hex}-${alpha}`;
  if (hexToRgbaCache.has(cacheKey)) {
    return hexToRgbaCache.get(cacheKey);
  }

  // Remove # if present
  hex = hex.replace('#', '');

  // Handle shorthand hex (e.g., #fff)
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((char) => char + char)
      .join('');
  }

  if (hex.length !== 6 && hex.length !== 8) return null;

  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const a = hex.length === 8 ? parseInt(hex.substring(6, 8), 16) / 255 : alpha;

  const result = { r, g, b, a };
  hexToRgbaCache.set(cacheKey, result);
  return result;
}

/**
 * Gets first color scheme from settings
 */
function getFirstColorScheme() {
  if (!shopifySettings || !shopifySettings.color_schemes) {
    return null;
  }

  const schemes = shopifySettings.color_schemes;
  const firstSchemeKey = Object.keys(schemes)[0];

  return firstSchemeKey ? schemes[firstSchemeKey] : null;
}

/**
 * Resolves Liquid variable {{ settings.variable_name }} or {{ settings.variable.property }}
 * Also supports {{ scheme.settings.* }} for color scheme variables
 */
function resolveLiquidVariable(liquidVar) {
  // Check for scheme.settings.* pattern (color schemes)
  const schemeMatch = liquidVar.match(/\{\{\s*scheme\.settings\.([\w.]+)\s*\}\}/);
  if (schemeMatch) {
    const firstScheme = getFirstColorScheme();
    if (!firstScheme || !firstScheme.settings) {
      return `[scheme.${schemeMatch[1]}]`;
    }

    const varPath = schemeMatch[1].split('.');
    let value = firstScheme.settings;

    // Navigate through nested properties
    for (const prop of varPath) {
      if (value && typeof value === 'object') {
        value = value[prop];
      } else {
        break;
      }
    }

    // Handle color properties with .rgba or .rgb accessors
    if (typeof value === 'string' && value.startsWith('#')) {
      const lastProp = varPath[varPath.length - 1];

      if (lastProp === 'rgba') {
        const rgba = hexToRgba(value);
        return rgba ? `${rgba.r}, ${rgba.g}, ${rgba.b}, ${rgba.a}` : value;
      } else if (lastProp === 'rgb') {
        const rgba = hexToRgba(value);
        return rgba ? `${rgba.r} ${rgba.g} ${rgba.b}` : value;
      }

      // If it's a color without accessor, try to return RGBA
      const rgba = hexToRgba(value);
      return rgba ? `${rgba.r}, ${rgba.g}, ${rgba.b}, ${rgba.a}` : value;
    }

    return formatSettingValue(value, varPath[0]);
  }

  // Extract variable name from {{ settings.variable_name }} or {{ settings.var.property }}
  const match = liquidVar.match(/\{\{\s*settings\.([\w.]+)\s*\}\}/);
  if (!match) {
    return liquidVar;
  }

  const varPath = match[1].split('.');
  const varName = varPath[0];

  // Search in current settings
  if (shopifySettings && shopifySettings[varName] !== undefined) {
    let value = shopifySettings[varName];

    // If there are nested properties (e.g., type_body_font.family)
    for (let i = 1; i < varPath.length; i++) {
      if (value && typeof value === 'object') {
        value = value[varPath[i]];
      } else {
        // If value is not an object, it might be a string representation
        // e.g. "inter_n4" for font
        break;
      }
    }

    return formatSettingValue(value, varName);
  }

  // Search in defaults
  if (shopifySettingsSchema && shopifySettingsSchema[varName] !== undefined) {
    const value = shopifySettingsSchema[varName];
    return formatSettingValue(value, varName);
  }

  // If not found, return variable name for visibility
  return `[${varPath.join('.')}]`;
}

/**
 * Formats setting value
 */
function formatSettingValue(value, varName) {
  // Simply return value as is, without adding units
  // Units (px, %, rem) are already in Liquid template

  // If it's a number - return as string
  if (typeof value === 'number') {
    return String(value);
  }

  // If it's a boolean value
  if (typeof value === 'boolean') {
    return value.toString();
  }

  // If it's a string
  if (typeof value === 'string') {
    return value;
  }

  // For objects and other types
  if (typeof value === 'object') {
    return '[object]';
  }

  return String(value);
}

/**
 * Scans all Liquid files and extracts CSS variables from {% style %} blocks
 */
async function scanLiquidFiles() {
  try {
    cssVariables.clear();
    settingValueCache.clear(); // Clear cache for new scan

    // Load Shopify settings
    shopifySettings = await loadShopifySettings();
    shopifySettingsSchema = await loadShopifySettingsSchema();

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return 0;
    }

    // Get extension configuration
    const config = getExtensionConfig();

    // Collect all file reading promises
    const filePromises = [];

    for (const folder of workspaceFolders) {
      // Scan files for each include pattern
      for (const includePattern of config.includePatterns) {
        // Combine all exclude patterns
        const excludePattern = config.excludePatterns.length > 0 ? `{${config.excludePatterns.join(',')}}` : undefined;

        const liquidFiles = await vscode.workspace.findFiles(
          new vscode.RelativePattern(folder, includePattern),
          excludePattern,
        );

        // Read files in parallel
        for (const fileUri of liquidFiles) {
          filePromises.push(
            vscode.workspace.fs
              .readFile(fileUri)
              .then((content) => {
                const text = Buffer.from(content).toString('utf8');
                // Early exit if no :root
                if (text.includes(':root')) {
                  parseCssVariables(text, fileUri.fsPath);
                }
              })
              .catch((error) => {
                console.error(`Error reading file ${fileUri.fsPath}:`, error);
              }),
          );
        }
      }
    }

    // Wait for all files to be processed
    await Promise.all(filePromises);

    console.log(`\n✓ Found ${cssVariables.size} CSS variables`);
    return cssVariables.size;
  } catch (error) {
    console.error('Error in scanLiquidFiles:', error);
    vscode.window.showErrorMessage(`Failed to scan files: ${error.message}`);
    return 0;
  }
}

/**
 * Finds matching closing brace for given opening brace
 * Optimized version
 */
function findMatchingBrace(text, startIndex) {
  let depth = 1;
  const len = text.length;

  for (let i = startIndex; i < len && depth > 0; i++) {
    const char = text[i];
    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }

  return -1;
}

/**
 * Processes if/elsif/else block in Liquid (simplified version)
 */
function processIfBlock(ifLine, allLines, variables) {
  // Deprecated - use processIfBlockInLoop instead
  return '';
}

/**
 * Processes if/elsif/else/endif block in loop and returns output + next index
 */
function processIfBlockInLoop(lines, startIndex, variables) {
  let output = '';
  let i = startIndex;

  // Parse if condition
  const ifLine = lines[i];
  const ifMatch = ifLine.match(/if\s+(.+)/);
  if (!ifMatch) return { output: '', nextIndex: i + 1 };

  const ifCondition = ifMatch[1].trim();
  let conditionMet = evaluateLiquidCondition(ifCondition, variables);

  // Collect branches: if, elsif*, else
  const branches = [{ condition: ifCondition, met: conditionMet, lines: [] }];
  let currentBranch = 0;
  let depth = 1;
  i++;

  while (i < lines.length && depth > 0) {
    const line = lines[i];

    if (line.startsWith('if ')) {
      depth++;
      branches[currentBranch].lines.push(line);
    } else if (line.startsWith('endif')) {
      depth--;
      if (depth === 0) break;
      branches[currentBranch].lines.push(line);
    } else if (line.startsWith('elsif ') && depth === 1) {
      const elsifMatch = line.match(/elsif\s+(.+)/);
      if (elsifMatch) {
        const elsifCondition = elsifMatch[1].trim();
        const elsifMet = !conditionMet && evaluateLiquidCondition(elsifCondition, variables);
        branches.push({ condition: elsifCondition, met: elsifMet, lines: [] });
        currentBranch++;
        if (elsifMet) conditionMet = true;
      }
    } else if (line.startsWith('else') && depth === 1) {
      branches.push({ condition: null, met: !conditionMet, lines: [] });
      currentBranch++;
    } else {
      branches[currentBranch].lines.push(line);
    }

    i++;
  }

  // Execute the branch that met its condition
  for (const branch of branches) {
    if (branch.met) {
      for (const branchLine of branch.lines) {
        if (branchLine.startsWith('echo ')) {
          const echoExpr = branchLine.substring(5).trim();
          output += evaluateLiquidExpression(echoExpr, variables);
        } else if (branchLine.startsWith('assign ')) {
          const assignMatch = branchLine.match(/assign\s+([\w_]+)\s*=\s*(.+)/);
          if (assignMatch) {
            const [, varName, expression] = assignMatch;
            variables[varName] = evaluateLiquidExpression(expression.trim(), variables);
          }
        }
      }
      break;
    }
  }

  return { output, nextIndex: i + 1 };
}

/**
 * Evaluates Liquid condition (optimized)
 */
function evaluateLiquidCondition(condition, variables) {
  // Handle 'contains' operator
  if (condition.includes(' contains ')) {
    const [left, right] = condition.split(' contains ').map((s) => s.trim());
    const leftVal = String(evaluateLiquidExpression(left, variables));
    const rightVal = String(evaluateLiquidExpression(right, variables));
    return leftVal.includes(rightVal);
  }

  // Use regex for faster operator detection and parsing
  const comparisonMatch = condition.match(/(.+?)\s*(>=|<=|>|<|==)\s*(.+)/);
  if (comparisonMatch) {
    const [, left, operator, right] = comparisonMatch;
    const leftVal = evaluateLiquidExpression(left.trim(), variables);
    const rightVal = evaluateLiquidExpression(right.trim(), variables);

    // For numeric comparisons
    if (operator !== '==') {
      const leftNum = parseFloat(leftVal);
      const rightNum = parseFloat(rightVal);
      switch (operator) {
        case '>=':
          return leftNum >= rightNum;
        case '<=':
          return leftNum <= rightNum;
        case '>':
          return leftNum > rightNum;
        case '<':
          return leftNum < rightNum;
      }
    }
    // For == comparison
    return leftVal == rightVal;
  }

  // Simple truthy check
  const value = evaluateLiquidExpression(condition, variables);
  return !!value;
}

/**
 * Executes Liquid block and returns CSS output
 */
function executeLiquidBlock(liquidCode) {
  const variables = {};
  let output = '';
  const lines = liquidCode
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l);

  let skipMode = false; // For skipping comment blocks

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Handle comment blocks
    if (line === 'comment' || line.startsWith('comment ')) {
      skipMode = true;
      continue;
    }
    if (line === 'endcomment') {
      skipMode = false;
      continue;
    }
    if (skipMode) {
      continue;
    }

    // Process 'assign' statements
    if (line.startsWith('assign ')) {
      const assignMatch = line.match(/assign\s+([\w_]+)\s*=\s*(.+)/);
      if (assignMatch) {
        const [, varName, expression] = assignMatch;
        variables[varName] = evaluateLiquidExpression(expression.trim(), variables);
      }
      continue;
    }

    // Process 'for' loops
    if (line.startsWith('for ')) {
      const forMatch = line.match(/for\s+([\w_]+)\s+in\s+([\w_]+)/);
      if (forMatch) {
        const [, itemVar, arrayVar] = forMatch;
        const array = variables[arrayVar] || [];

        // Find 'endfor'
        let forBody = [];
        i++;
        let depth = 1;
        while (i < lines.length && depth > 0) {
          if (lines[i].startsWith('for ')) depth++;
          if (lines[i].startsWith('endfor')) {
            depth--;
            if (depth === 0) break;
          }
          forBody.push(lines[i]);
          i++;
        }

        // Execute loop
        if (Array.isArray(array)) {
          for (let j = 0; j < array.length; j++) {
            variables[itemVar] = array[j];
            variables['forloop'] = { index: j + 1 };

            // Process for body
            let k = 0;
            while (k < forBody.length) {
              const bodyLine = forBody[k];

              if (bodyLine.startsWith('echo ')) {
                const echoExpr = bodyLine.substring(5).trim();
                output += evaluateLiquidExpression(echoExpr, variables);
                k++;
              } else if (bodyLine.startsWith('assign ')) {
                const assignMatch = bodyLine.match(/assign\s+([\w_]+)\s*=\s*(.+)/);
                if (assignMatch) {
                  const [, varName, expression] = assignMatch;
                  variables[varName] = evaluateLiquidExpression(expression.trim(), variables);
                }
                k++;
              } else if (bodyLine.startsWith('if ')) {
                // Process if/elsif/else/endif block
                const ifResult = processIfBlockInLoop(forBody, k, variables);
                output += ifResult.output;
                k = ifResult.nextIndex;
              } else {
                k++;
              }
            }
          }
        }
      }
      continue;
    }

    // Process 'unless' blocks (opposite of if)
    if (line.startsWith('unless ')) {
      const unlessMatch = line.match(/unless\s+(.+)/);
      if (unlessMatch) {
        const condition = unlessMatch[1].trim();
        const conditionMet = !evaluateLiquidCondition(condition, variables); // Inverted logic

        // Find 'endunless'
        let unlessBody = [];
        i++;
        let depth = 1;
        while (i < lines.length && depth > 0) {
          if (lines[i].startsWith('unless ')) depth++;
          if (lines[i].startsWith('endunless')) {
            depth--;
            if (depth === 0) break;
          }
          unlessBody.push(lines[i]);
          i++;
        }

        // Execute unless body if condition is not met
        if (conditionMet) {
          for (const unlessLine of unlessBody) {
            if (unlessLine.startsWith('echo ')) {
              const echoExpr = unlessLine.substring(5).trim();
              output += evaluateLiquidExpression(echoExpr, variables);
            } else if (unlessLine.startsWith('assign ')) {
              const assignMatch = unlessLine.match(/assign\s+([\w_]+)\s*=\s*(.+)/);
              if (assignMatch) {
                const [, varName, expression] = assignMatch;
                variables[varName] = evaluateLiquidExpression(expression.trim(), variables);
              }
            }
          }
        }
      }
      continue;
    }

    // Process 'echo' statements
    if (line.startsWith('echo ')) {
      const echoExpr = line.substring(5).trim();
      output += evaluateLiquidExpression(echoExpr, variables);
      continue;
    }
  }
  return output;
}

/**
 * Evaluates Liquid expression with filters
 */
function evaluateLiquidExpression(expr, variables) {
  // Split by pipe, but not inside quotes
  const parts = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < expr.length; i++) {
    const char = expr[i];

    if ((char === '"' || char === "'") && (i === 0 || expr[i - 1] !== '\\')) {
      if (!inQuotes) {
        inQuotes = true;
        quoteChar = char;
        current += char;
      } else if (char === quoteChar) {
        inQuotes = false;
        quoteChar = '';
        current += char;
      } else {
        current += char;
      }
    } else if (char === '|' && !inQuotes) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current) parts.push(current.trim());

  let value = parts[0];

  // Handle quoted strings
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    value = value.slice(1, -1);
  }
  // Evaluate base value
  else if (value.includes('[')) {
    // Array/object access: font_size_values[next_font_size_index] or settings[size_setting]
    const arrayMatch = value.match(REGEX.arrayAccess);
    if (arrayMatch) {
      const [, objectName, indexExpr] = arrayMatch;

      if (objectName === 'settings') {
        // settings[variable] - evaluate variable first
        const settingKey = evaluateLiquidExpression(indexExpr, variables);
        const settingValue = getSettingValue(String(settingKey));
        value = settingValue !== undefined ? settingValue : '';
      } else {
        // Regular array access
        const array = variables[objectName];
        const index = evaluateLiquidExpression(indexExpr, variables);
        value = Array.isArray(array) ? array[parseInt(index)] : '';
      }
    }
  } else if (value.includes('.')) {
    // Property access: settings.type_size_paragraph or object.property
    const propMatch = value.match(REGEX.propAccess);
    if (propMatch) {
      const [, objectName, propertyName] = propMatch;

      if (objectName === 'settings') {
        // Special handling for settings
        value = getSettingValue(propertyName);
        if (value === undefined) value = '';
      } else {
        // General object property access
        const obj = variables[objectName];
        if (obj && typeof obj === 'object' && propertyName in obj) {
          value = obj[propertyName];
        } else {
          // If not found, return the original expression
          value = value;
        }
      }
    } else if (value.match(/^[\w_]+$/)) {
      // Variable reference
      value = variables[value] !== undefined ? variables[value] : value;
    }
  } else if (value.match(/^[\w_]+$/)) {
    // Variable reference
    value = variables[value] !== undefined ? variables[value] : value;
  } else if (value.match(/^\d+(\.\d+)?$/)) {
    // Numeric literal
    value = parseFloat(value);
  } else {
    // Try to evaluate as expression
    const varMatch = value.match(/'?\[([^\]]+)\]'?/g);
    if (varMatch) {
      varMatch.forEach((placeholder) => {
        const varName = placeholder.replace(/['"\[\]]/g, '');
        const varValue = variables[varName] !== undefined ? variables[varName] : '';
        value = value.replace(placeholder, varValue);
      });
    }
  }

  // Apply filters
  for (let i = 1; i < parts.length; i++) {
    value = applyLiquidFilter(value, parts[i], variables);
  }

  return value;
}

/**
 * Applies Liquid filter to value
 */
function applyLiquidFilter(value, filter, variables) {
  const filterMatch = filter.match(/^([\w_]+)(?::\s*(.+))?$/);
  if (!filterMatch) return value;

  const [, filterName, filterArg] = filterMatch;

  switch (filterName) {
    case 'split':
      // Extract the split delimiter from filterArg (e.g., split: ", " or split: ',')
      let splitBy = ',';
      if (filterArg) {
        // Remove outer quotes if present
        splitBy = filterArg.trim().replace(/^['"]|['"]$/g, '');
      }
      return String(value).split(splitBy);

    case 'replace':
      const replaceArgs = filterArg.match(/['"]([^'"]*)['"]\s*,\s*(.+)/);
      if (replaceArgs) {
        const [, search, replace] = replaceArgs;
        let replaceValueExpr = replace.trim();

        // Evaluate the replacement expression (handles variables, settings[x], obj.prop, etc.)
        let replaceValue = evaluateLiquidExpression(replaceValueExpr, variables);

        // If evaluation returns the same expression, try removing quotes as fallback
        if (replaceValue === replaceValueExpr && replaceValueExpr.match(/^['"].*['"]$/)) {
          replaceValue = replaceValueExpr.replace(/^['"]|['"]$/g, '');
        }

        // Escape special regex characters in search string and use it as-is
        const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return String(value).replace(new RegExp(escapedSearch, 'g'), String(replaceValue));
      }
      return value;

    case 'append':
      const appendValue = filterArg ? evaluateLiquidExpression(filterArg, variables) : '';
      return String(value) + appendValue;

    case 'times':
      const multiplier = filterArg ? parseFloat(evaluateLiquidExpression(filterArg, variables)) : 1;
      const timesResult = parseFloat(value) * multiplier;
      if (isNaN(timesResult)) return 0;
      // Round to avoid floating point precision issues
      return Math.round(timesResult * 100000) / 100000;

    case 'divided_by':
      const divisor = filterArg ? parseFloat(evaluateLiquidExpression(filterArg, variables)) : 1;
      if (divisor === 0) return 0;
      const divResult = parseFloat(value) / divisor;
      if (isNaN(divResult)) return 0;
      // Round to avoid floating point precision issues
      return Math.round(divResult * 100000) / 100000;

    case 'minus':
      const subtrahend = filterArg ? parseFloat(evaluateLiquidExpression(filterArg, variables)) : 0;
      const minusResult = parseFloat(value) - subtrahend;
      return isNaN(minusResult) ? 0 : minusResult;

    case 'plus':
      const addend = filterArg ? parseFloat(evaluateLiquidExpression(filterArg, variables)) : 0;
      const plusResult = parseFloat(value) + addend;
      return isNaN(plusResult) ? 0 : plusResult;

    case 'uniq':
      return Array.isArray(value) ? [...new Set(value)] : value;

    case 'sort_natural':
      return Array.isArray(value)
        ? value.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))
        : value;

    case 'find_index':
      const searchValue = filterArg ? evaluateLiquidExpression(filterArg, variables) : '';
      if (!Array.isArray(value)) return -1;
      const searchStr = String(searchValue);

      // Try exact string match first
      let result = value.indexOf(searchStr);

      // If not found, try numeric comparison (handles "48" vs "048")
      if (result === -1) {
        const searchNum = parseFloat(searchStr);
        if (!isNaN(searchNum)) {
          result = value.findIndex((v) => parseFloat(v) === searchNum);
        }
      }

      return result;

    // Shopify-specific filters that we can't emulate - just return the original value
    case 'font_modify':
    case 'font_face':
      return value;

    default:
      return value;
  }
}

/**
 * Emulates Liquid to CSS conversion - removes/processes Liquid tags to get clean CSS
 */
function liquidToCSS(text) {
  // Step 0: Process {% liquid %} and {%- liquid %} blocks
  text = text.replace(REGEX.liquidBlock, (match, liquidCode) => {
    return executeLiquidBlock(liquidCode);
  });

  // Step 1: Process {% for scheme in settings.color_schemes %} loops
  // Take only the first iteration (forloop.index == 1)
  text = text.replace(REGEX.forScheme, (match, schemeVar, loopContent) => {
    // Simulate first iteration
    let firstIteration = loopContent;

    // Replace {{ scheme.id }} with "scheme-1" (first scheme)
    const firstScheme = getFirstColorScheme();
    const schemeId = firstScheme ? Object.keys(shopifySettings.color_schemes)[0] : 'scheme-1';
    firstIteration = firstIteration.replace(new RegExp(`\\{\\{\\s*${schemeVar}\\.id\\s*\\}\\}`, 'g'), schemeId);

    // Replace {{ forloop.index }} with 1
    firstIteration = firstIteration.replace(/\{\{\s*forloop\.index\s*\}\}/g, '1');

    // Keep only the content for forloop.index == 1
    firstIteration = firstIteration.replace(/{%\s*if\s+forloop\.index\s*==\s*1\s*%}([\s\S]*?){%\s*endif\s*%}/gi, '$1');

    // Remove other forloop.index conditions
    firstIteration = firstIteration.replace(/{%\s*if\s+forloop\.index\s*[^%]+%}[\s\S]*?{%\s*endif\s*%}/gi, '');

    return firstIteration;
  });

  // Step 2: Process {% assign %} statements - just remove them
  text = text.replace(REGEX.assign, '');

  // Step 3: Process conditional blocks {% if settings.* %}
  text = processConditionalBlocks(text);

  // Step 4: Process other {% if %} blocks (like background_brightness)
  text = text.replace(REGEX.ifBlock, (match, thenContent) => {
    // Optimistically include the "then" branch
    return thenContent;
  });

  // Step 5: Replace {{ scheme.settings.* }} with actual values (with optional | append: filter)
  text = text.replace(REGEX.schemeSettings, (match, settingPath, appendValue) => {
    const resolved = resolveLiquidVariable(`{{ scheme.settings.${settingPath} }}`);
    if (appendValue && resolved !== `{{ scheme.settings.${settingPath} }}`) {
      return resolved + appendValue;
    }
    return resolved;
  });

  // Step 6: Replace {{ settings.* }} with actual values (with optional | append: filter)
  text = text.replace(REGEX.settings, (match, settingName, appendValue) => {
    const resolved = resolveLiquidVariable(`{{ settings.${settingName} }}`);
    if (appendValue && resolved !== `{{ settings.${settingName} }}`) {
      return resolved + appendValue;
    }
    return resolved;
  });

  // Step 7: Replace {{ variable_name }} (local variables like opacity_5_15)
  text = text.replace(REGEX.variable, '0.15'); // Default opacity value

  // Step 8: Remove any remaining Liquid tags
  text = text.replace(REGEX.liquidTags, '');
  text = text.replace(REGEX.liquidOutput, '');

  return text;
}

/**
 * Parses text and extracts CSS variables from {% style %} and :root blocks
 */
function parseCssVariables(text, filePath) {
  // Quick checks: if no :root or file too small, skip
  if (!text || text.length < 50 || !text.includes(':root')) {
    return;
  }

  const config = getExtensionConfig();

  // Find all style blocks: {% style %}, {% stylesheet %}, <style>
  const styleBlocks = [];

  // Match {% style %}...{% endstyle %}
  const liquidStyleRegex = /{%\s*style\s*%}([\s\S]*?){%\s*endstyle\s*%}/gi;
  let match;
  while ((match = liquidStyleRegex.exec(text)) !== null) {
    // Skip if no :root in this block
    if (match[1].includes(':root')) {
      styleBlocks.push({ type: '{% style %}', content: match[1], start: match.index });
    }
  }

  // Match {% stylesheet %}...{% endstylesheet %}
  const liquidSheetRegex = /{%\s*stylesheet\s*%}([\s\S]*?){%\s*endstylesheet\s*%}/gi;
  while ((match = liquidSheetRegex.exec(text)) !== null) {
    // Skip if no :root in this block
    if (match[1].includes(':root')) {
      styleBlocks.push({ type: '{% stylesheet %}', content: match[1], start: match.index });
    }
  }

  // Match <style>...</style>
  const htmlStyleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  while ((match = htmlStyleRegex.exec(text)) !== null) {
    // Skip if no :root in this block
    if (match[1].includes(':root')) {
      styleBlocks.push({ type: '<style>', content: match[1], start: match.index });
    }
  }

  // If no blocks with :root found, skip
  if (styleBlocks.length === 0) {
    return;
  }

  // Sort by position in file
  styleBlocks.sort((a, b) => a.start - b.start);

  // Process each style block
  for (let i = 0; i < styleBlocks.length; i++) {
    const block = styleBlocks[i];

    // Convert Liquid to CSS
    const cleanCSS = liquidToCSS(block.content);

    // Skip if no :root after conversion
    if (!cleanCSS.includes(':root')) {
      continue;
    }

    // Parse Liquid echo commands that generate CSS variables
    parseLiquidEchoVariables(cleanCSS, filePath);

    // Find :root blocks
    parseRootBlocks(cleanCSS, filePath);

    // Find class blocks - only if onlyRoot is false
    if (!config.onlyRoot) {
      parseClassBlocks(cleanCSS, filePath);
    }
  }
}

/**
 * Processes conditional blocks {% if settings.* %} and removes content if condition is false
 */
function processConditionalBlocks(text) {
  // Match {% if settings.variable ... %}...{% elsif %}...{% else %}...{% endif %} blocks
  const ifRegex = /{%\s*if\s+([\s\S]*?)%}([\s\S]*?){%\s*endif\s*%}/gi;

  return text.replace(ifRegex, (match, condition, blockContent) => {
    // Split block content by {% elsif %} and {% else %}
    const parts = [];
    let currentContent = blockContent;

    // Extract {% elsif %} branches
    const elsifRegex = /{%\s*elsif\s+([\s\S]*?)%}([\s\S]*?)(?={%\s*(?:elsif|else|endif))/gi;
    let elsifMatch;
    let lastIndex = 0;

    // First branch (initial if condition)
    const firstElsifMatch = /{%\s*elsif/.exec(currentContent);
    const firstElseMatch = /{%\s*else\s*%}/.exec(currentContent);
    const firstEnd = Math.min(
      firstElsifMatch ? firstElsifMatch.index : Infinity,
      firstElseMatch ? firstElseMatch.index : Infinity,
    );

    parts.push({
      condition: condition,
      content: currentContent.substring(0, firstEnd !== Infinity ? firstEnd : currentContent.length),
    });

    // Extract elsif branches
    while ((elsifMatch = elsifRegex.exec(blockContent)) !== null) {
      parts.push({
        condition: elsifMatch[1].trim(),
        content: elsifMatch[2],
      });
    }

    // Extract else branch
    const elseMatch = /{%\s*else\s*%}([\s\S]*)$/.exec(blockContent);
    if (elseMatch) {
      parts.push({
        condition: null, // else has no condition (always true)
        content: elseMatch[1],
      });
    }

    // Evaluate conditions and return matching branch
    for (const part of parts) {
      if (part.condition === null) {
        // else branch - always matches
        return part.content;
      }

      if (evaluateCondition(part.condition)) {
        return part.content;
      }
    }

    // No condition matched, remove entire block
    return '';
  });
}

/**
 * Evaluates a Liquid condition like "settings.icon_stroke == 'thin'"
 */
function evaluateCondition(condition) {
  condition = condition.trim();

  // Handle comparison operators: ==, !=, <, >, <=, >=
  const comparisonMatch = condition.match(/settings\.([\w.]+)\s*(==|!=|<=|>=|<|>)\s*(['"]?)(.+?)\3/);
  if (comparisonMatch) {
    const [, settingKey, operator, quote, compareValue] = comparisonMatch;
    const settingValue = getSettingValue(settingKey);

    // Convert to appropriate type
    const actualValue = settingValue;
    const expectedValue = quote ? compareValue : isNaN(compareValue) ? compareValue : Number(compareValue);

    switch (operator) {
      case '==':
        return actualValue == expectedValue;
      case '!=':
        return actualValue != expectedValue;
      case '<':
        return actualValue < expectedValue;
      case '>':
        return actualValue > expectedValue;
      case '<=':
        return actualValue <= expectedValue;
      case '>=':
        return actualValue >= expectedValue;
    }
  }

  // Handle simple boolean check: settings.variable
  const simpleBoolMatch = condition.match(/settings\.([\w.]+)/);
  if (simpleBoolMatch) {
    const settingKey = simpleBoolMatch[1];
    const settingValue = getSettingValue(settingKey);
    return settingValue !== false && settingValue !== undefined && settingValue !== null && settingValue !== '';
  }

  return false;
}

/**
 * Gets setting value from settings_data or settings_schema
 */
function getSettingValue(settingKey) {
  // Check cache first
  if (settingValueCache.has(settingKey)) {
    return settingValueCache.get(settingKey);
  }

  let settingValue = shopifySettings?.[settingKey];

  // Handle nested properties (e.g., settings.section.property)
  if (settingKey.includes('.')) {
    const keys = settingKey.split('.');
    settingValue = shopifySettings;
    for (const key of keys) {
      if (settingValue && typeof settingValue === 'object') {
        settingValue = settingValue[key];
      } else {
        settingValue = undefined;
        break;
      }
    }
  }

  // If not found in settings_data, check settings_schema for default value
  if (settingValue === undefined && shopifySettingsSchema) {
    settingValue = shopifySettingsSchema[settingKey];
  }

  // Cache result
  settingValueCache.set(settingKey, settingValue);
  return settingValue;
}

/**
 * Parses Liquid echo commands for CSS variables
 * NOTE: Expects clean CSS text (after liquidToCSS conversion)
 */
function parseLiquidEchoVariables(text, filePath) {
  // Text is already cleaned from Liquid tags
  // This function may not be needed anymore, but keeping for compatibility

  // Find echo with CSS variables, e.g.: echo '--font-size--h1: 2rem;'
  const echoRegex = /echo\s+['"]([^'"]*--[\w-]+\s*:[^'"]+)['"]/g;
  let echoMatch;

  while ((echoMatch = echoRegex.exec(text)) !== null) {
    const echoContent = echoMatch[1];

    // Extract CSS variables from echo
    const variableRegex = /--([\w-]+)\s*:\s*([^;]+)/g;
    let varMatch;

    while ((varMatch = variableRegex.exec(echoContent)) !== null) {
      const varName = `--${varMatch[1]}`;
      let varValue = varMatch[2].trim();

      // Clean Liquid interpolation like [font_size]
      varValue = varValue.replace(/\[[\w-]+\]/g, '...');

      if (!cssVariables.has(varName)) {
        cssVariables.set(varName, {
          value: varValue,
          file: path.basename(filePath),
          filePath: filePath,
        });
      }
    }
  }
}

/**
 * Parses :root blocks with nested braces support
 * NOTE: Expects clean CSS text (after liquidToCSS conversion)
 */
function parseRootBlocks(text, filePath) {
  // Simple match for :root blocks (text is already cleaned from Liquid)
  // Reset lastIndex for global regex\n  REGEX.rootBlock.lastIndex = 0;
  let rootStartMatch;

  while ((rootStartMatch = REGEX.rootBlock.exec(text)) !== null) {
    // Position after the opening {
    const startPos = rootStartMatch.index + rootStartMatch[0].length;
    const endPos = findMatchingBrace(text, startPos);

    if (endPos === -1) {
      continue;
    }

    const rootContent = text.substring(startPos, endPos - 1);

    // Parse base variables (outside @media)
    parseVariablesInBlock(rootContent, filePath, null);

    // Parse @media blocks
    parseMediaBlocks(rootContent, filePath);
  }
}

/**
 * Parses CSS variables in a block of text (optimized)
 */
function parseVariablesInBlock(content, filePath, mediaQuery) {
  // Reset lastIndex for global regex
  REGEX.cssVariable.lastIndex = 0;
  let varMatch;

  while ((varMatch = REGEX.cssVariable.exec(content)) !== null) {
    const varName = `--${varMatch[1]}`;
    const varValue = varMatch[2].trim();

    // Store or update the variable
    if (!cssVariables.has(varName)) {
      cssVariables.set(varName, {
        value: varValue,
        file: path.basename(filePath),
        filePath: filePath,
        media: mediaQuery ? [{ query: mediaQuery, value: varValue }] : [],
      });
    } else {
      // Variable exists - add media query if applicable
      if (mediaQuery) {
        const varData = cssVariables.get(varName);
        varData.media.push({ query: mediaQuery, value: varValue });
      }
    }
  }
}

/**
 * Parses @media blocks and extracts CSS variables from them
 */
function parseMediaBlocks(content, filePath) {
  // Match @media ... { ... }
  // Reset lastIndex for global regex
  REGEX.mediaQuery.lastIndex = 0;
  let mediaMatch;

  while ((mediaMatch = REGEX.mediaQuery.exec(content)) !== null) {
    const mediaQuery = mediaMatch[1].trim();
    const startPos = mediaMatch.index + mediaMatch[0].length;
    const endPos = findMatchingBrace(content, startPos);

    if (endPos === -1) {
      continue;
    }

    const mediaContent = content.substring(startPos, endPos - 1);

    // Parse variables inside @media block
    parseVariablesInBlock(mediaContent, filePath, mediaQuery);
  }
}

/**
 * Parses class blocks (e.g., .color-scheme-1) with nested braces support
 * NOTE: Expects clean CSS text (after liquidToCSS conversion)
 */
function parseClassBlocks(text, filePath) {
  // Text is already cleaned from Liquid tags

  // Match class blocks like .color-scheme-1 {, .some-class {
  const classStartRegex = /\.[\w-]+\s*\{/gi;
  let classStartMatch;

  while ((classStartMatch = classStartRegex.exec(text)) !== null) {
    const startPos = classStartMatch.index + classStartMatch[0].length;
    const endPos = findMatchingBrace(text, startPos);

    if (endPos === -1) continue;

    const classContent = text.substring(startPos, endPos - 1);

    // Extract CSS variables (--variable-name: value;)
    const lines = classContent.split('\n');

    for (const line of lines) {
      // Skip comments and @media rules
      if (line.trim().startsWith('/*') || line.trim().startsWith('@media')) {
        continue;
      }

      const variableRegex = /--([\w-]+)\s*:\s*([^;]+);/g;
      let varMatch;

      while ((varMatch = variableRegex.exec(line)) !== null) {
        const varName = `--${varMatch[1]}`;
        let varValue = varMatch[2].trim();

        // Text is already cleaned, just store it
        if (!cssVariables.has(varName)) {
          cssVariables.set(varName, {
            value: varValue,
            file: path.basename(filePath),
            filePath: filePath,
            media: [],
          });
        }
      }
    }
  }
}

/**
 * Provider for CSS variable hover information
 */
class CssVariableHoverProvider {
  provideHover(document, position, token) {
    // Match CSS variables like --variable-name or inside var(--variable-name)
    const range = document.getWordRangeAtPosition(position, /--[\w-]+/);
    if (!range) {
      return null;
    }

    const word = document.getText(range);

    // Check if this variable exists in our cache
    if (!cssVariables.has(word)) {
      return null;
    }

    const varData = cssVariables.get(word);
    const config = getExtensionConfig();

    // Build hover content
    const contents = [];
    contents.push(`**CSS Variable:** \`${word}\``);
    contents.push(`**Value:** \`${varData.value}\``);

    // Create clickable link to file
    if (varData.filePath) {
      const fileUri = vscode.Uri.file(varData.filePath);
      contents.push(`**Source:** [${varData.file}](${fileUri.toString()})`);
    } else {
      contents.push(`**Source:** ${varData.file}`);
    }

    // Add media query variants if present
    if (varData.media && varData.media.length > 0) {
      contents.push('');
      contents.push('**Media Query Variants:**');
      for (const mediaVariant of varData.media) {
        contents.push(`- \`@media ${mediaVariant.query}\`: \`${mediaVariant.value}\``);
      }
    }

    // Add rem↔px conversion if applicable
    if (config.remToPxConversion) {
      const value = varData.value.trim();
      const remMatch = value.match(/([\d.]+)\s*rem/);
      if (remMatch) {
        const pxValue = remToPx(remMatch[1], config.baseFontSize);
        if (pxValue) {
          contents.push('');
          contents.push(`**Convert to px:** \`${pxValue}px\``);
        }
      } else {
        const pxMatch = value.match(/([\d.]+)\s*px/);
        if (pxMatch) {
          const remValue = pxToRem(pxMatch[1], config.baseFontSize);
          if (remValue) {
            contents.push('');
            contents.push(`**Convert to rem:** \`${remValue}rem\``);
          }
        }
      }
    }

    const markdown = new vscode.MarkdownString(contents.join('\n\n'));
    markdown.isTrusted = true; // Enable command links

    return new vscode.Hover(markdown, range);
  }
}

/**
 * Provider for CSS variable autocompletion
 */
class CssVariableCompletionProvider {
  provideCompletionItems(document, position, token, context) {
    const linePrefix = document.lineAt(position).text.substring(0, position.character);
    const config = getExtensionConfig();
    const completionItems = [];

    // Check once for insertion context
    const inVarContext = linePrefix.includes('var(');

    // Only provide completions inside var() context
    if (!inVarContext) {
      return completionItems;
    }

    const afterColonOrSpace = linePrefix.match(/[:\s]$/);

    // Check if user already typed '--' (to avoid duplication like '---variable')
    const alreadyTypedDashes = linePrefix.match(/--$/);

    for (const [varName, varData] of cssVariables) {
      const item = new vscode.CompletionItem(varName, vscode.CompletionItemKind.Variable);
      item.detail = varData.value;

      // Create documentation
      const docParts = [`**Value:** \`${varData.value}\``, `**From:** ${varData.file}`];

      // Add media query information if present
      if (varData.media && varData.media.length > 0) {
        const mediaInfo = varData.media.map((m) => `- \`@media ${m.query}\`: \`${m.value}\``).join('\n');
        docParts.push(`**Media Queries:**\n${mediaInfo}`);
      }

      // Add rem↔px conversion hints
      if (config.remToPxConversion) {
        const value = varData.value.trim();
        const remMatch = value.match(/([\d.]+)\s*rem/);
        if (remMatch) {
          const pxValue = remToPx(remMatch[1], config.baseFontSize);
          if (pxValue) docParts.push(`**Convert:** \`${pxValue}px\``);
        } else {
          const pxMatch = value.match(/([\d.]+)\s*px/);
          if (pxMatch) {
            const remValue = pxToRem(pxMatch[1], config.baseFontSize);
            if (remValue) docParts.push(`**Convert:** \`${remValue}rem\``);
          }
        }
      }

      item.documentation = new vscode.MarkdownString(docParts.join('\n\n'));

      // Set insertion text based on context
      if (alreadyTypedDashes) {
        // User typed '--', we need to replace it with the full variable name
        const replaceRange = new vscode.Range(position.line, position.character - 2, position.line, position.character);
        item.additionalTextEdits = [vscode.TextEdit.delete(replaceRange)];
        item.insertText = varName;
      } else if (inVarContext) {
        item.insertText = varName;
      } else if (afterColonOrSpace) {
        item.insertText = `var(${varName})`;
      } else {
        item.insertText = varName;
      }

      item.sortText = varName;
      completionItems.push(item);
    }

    return completionItems;
  }
}

/**
 * Extension activation
 */
function activate(context) {
  console.log('Liquid CSS Variable Completion extension is now active');

  // Initial file scan
  scanLiquidFiles();

  // Rescan on Liquid file save
  const liquidWatcher = vscode.workspace.createFileSystemWatcher('**/*.liquid');
  liquidWatcher.onDidChange(() => scanLiquidFiles());
  liquidWatcher.onDidCreate(() => scanLiquidFiles());
  liquidWatcher.onDidDelete(() => scanLiquidFiles());

  // Watcher for config files (settings_data.json, settings_schema.json)
  const configWatcher = vscode.workspace.createFileSystemWatcher('**/config/settings*.json');
  configWatcher.onDidChange(() => {
    console.log('Config files changed, rescanning...');
    scanLiquidFiles();
  });
  configWatcher.onDidCreate(() => scanLiquidFiles());

  // Listener for extension configuration changes
  const configChangeListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('liquidCssVariables')) {
      console.log('Extension configuration changed, rescanning...');
      invalidateConfigCache();
      scanLiquidFiles();
    }
  });

  // Register provider for different file types
  const completionProvider = new CssVariableCompletionProvider();

  const cssProvider = vscode.languages.registerCompletionItemProvider(
    ['css', 'scss', 'less', 'liquid', 'html'],
    completionProvider,
    '-',
    '(', // Triggers for autocompletion
  );

  // Register hover provider
  const hoverProvider = new CssVariableHoverProvider();

  const cssHoverProvider = vscode.languages.registerHoverProvider(
    ['css', 'scss', 'less', 'liquid', 'html'],
    hoverProvider,
  );

  // Command for manual refresh
  const refreshCommand = vscode.commands.registerCommand('liquid-css-variables.refresh', async () => {
    try {
      const varCount = await scanLiquidFiles();

      // Group variables by file
      const uniqueFiles = new Set();
      for (const [, varData] of cssVariables) {
        uniqueFiles.add(varData.file);
      }

      vscode.window.showInformationMessage(`✓ Found ${varCount} CSS variables from ${uniqueFiles.size} Liquid file(s)`);
    } catch (error) {
      console.error('Refresh command error:', error);
      vscode.window.showErrorMessage(`Refresh failed: ${error.message}`);
    }
  });

  context.subscriptions.push(
    cssProvider,
    cssHoverProvider,
    liquidWatcher,
    configWatcher,
    configChangeListener,
    refreshCommand,
  );
}

function deactivate() {
  cssVariables.clear();
  shopifySettings = null;
  shopifySettingsSchema = null;
}

module.exports = {
  activate,
  deactivate,
};
