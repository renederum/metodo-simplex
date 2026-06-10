/* ===========================================================
   MÉTODO SÍMPLEX DE DOS FASES - Investigación Operativa
   =========================================================== */

// ===================== CONSTANTES ===========================
const EPS = 1e-10;

// ===================== UTILIDADES ===========================
function isZero(v) { return Math.abs(v) < EPS; }

function fmt(v) {
  if (isZero(v)) return '0';
  const s = v.toFixed(4);
  return s.replace(/\.?0+$/, '');
}

function fmtRatio(v) {
  if (isZero(v)) return '0';
  return v.toFixed(4);
}

// ===================== MODELO ================================
class Problem {
  constructor(type, objective, constraints) {
    this.type = type;          // 'max' | 'min'
    this.objective = objective; // number[]
    this.constraints = constraints; // { coeffs: number[], sign: string, rhs: number }[]
    this.numVars = objective.length;
    this.numConstraints = constraints.length;
  }
}

// ===================== SOLVER ================================
class TwoPhaseSimplex {
  constructor(problem) {
    this.problem = problem;
    this.iterations = [];  // { phase, iteration, tableauData, pivotCol, pivotRow, explanation }
    this.status = null;    // 'optimal' | 'infeasible' | 'unbounded'
    this.solution = null;
    this.optimalValue = null;

    this.varNames = [];
    this.slackCount = 0;
    this.artificialCount = 0;
    this.totalVars = 0;

    this.numConstraints = problem.numConstraints;
    this.numDecisionVars = problem.numVars;
  }

  // ---- Generar nombres de variables ----
  _genVarNames() {
    const names = [];
    for (let i = 0; i < this.numDecisionVars; i++) {
      names.push(`x${i + 1}`);
    }
    for (let i = 0; i < this.slackCount; i++) {
      names.push(`s${i + 1}`);
    }
    for (let i = 0; i < this.artificialCount; i++) {
      names.push(`r${i + 1}`);
    }
    return names;
  }

  // ---- Resolver ----
  solve() {
    this.iterations = [];

    const phase1Result = this._phase1();
    if (this.status === 'infeasible' || this.status === 'unbounded') return;

    this._phase2(phase1Result);
  }

  // =================== FASE 1 ================================
  _phase1() {
    const p = this.problem;
    const m = p.numConstraints;
    const n = p.numVars;

    // Normalizar: RHS debe ser no negativo
    for (const constr of p.constraints) {
      if (constr.rhs < -EPS) {
        for (let j = 0; j < n; j++) constr.coeffs[j] *= -1;
        constr.rhs *= -1;
        if (constr.sign === '<=') constr.sign = '>=';
        else if (constr.sign === '>=') constr.sign = '<=';
      }
    }

    // Contar tipos de variables a agregar
    this.slackCount = 0;
    this.artificialCount = 0;

    for (const c of p.constraints) {
      if (c.sign === '<=') this.slackCount++;
      else if (c.sign === '>=') { this.slackCount++; this.artificialCount++; }
      else if (c.sign === '=') this.artificialCount++;
    }

    this.varNames = this._genVarNames();
    this.totalVars = n + this.slackCount + this.artificialCount;

    // Construir matriz extendida [A | I | b]
    // Columnas: [x1..xn | slack/surplus | artificial | RHS]
    const cols = this.totalVars + 1; // +1 para RHS
    const rows = m + 1; // restricciones + obj fase 1

    const mat = Array.from({ length: rows }, () => new Array(cols).fill(0));

    // Llenar restricciones
    let sOff = n;  // offset para slack variables
    let aOff = n + this.slackCount;  // offset para artificial variables

    const artRows = []; // filas con vars artificiales

    for (let i = 0; i < m; i++) {
      const constr = p.constraints[i];
      // Coeficientes de variables de decisión
      for (let j = 0; j < n; j++) {
        mat[i][j] = constr.coeffs[j];
      }
      // RHS
      mat[i][cols - 1] = constr.rhs;

      if (constr.sign === '<=') {
        // + slack
        mat[i][sOff] = 1;
        sOff++;
      } else if (constr.sign === '>=') {
        // - surplus + artificial
        mat[i][sOff] = -1;
        mat[i][aOff] = 1;
        artRows.push({ row: i, col: aOff });
        sOff++;
        aOff++;
      } else if (constr.sign === '=') {
        // + artificial
        mat[i][aOff] = 1;
        artRows.push({ row: i, col: aOff });
        aOff++;
      }
    }

    // Fase 1: minimizar w = suma de artificiales
    // Inicial: w - sum(Ri) = 0  => w + (-1)*Ri = 0
    // Coeficientes de w en el tableau: 0 para no-artificiales, -1 para artificiales
    const wRow = rows - 1;
    for (const ar of artRows) {
      mat[wRow][ar.col] = -1;
    }
    // La variable w (objetivo) es implícita - no está en el tableau

    // Eliminar vars artificiales de la fila w (son básicas)
    for (const ar of artRows) {
      for (let j = 0; j < cols; j++) {
        mat[wRow][j] -= (-1) * mat[ar.row][j]; // w_row = w_row - (-1) * row_i
      }
    }

    // Rastrear vars básicas
    const basicVars = new Array(m).fill(-1);
    // Asignar básicas: para ≤, la slack es básica; para = o ≥, la artificial es básica
    sOff = n;
    aOff = n + this.slackCount;
    for (let i = 0; i < m; i++) {
      const constr = p.constraints[i];
      if (constr.sign === '<=') {
        basicVars[i] = sOff;
        sOff++;
      } else if (constr.sign === '>=') {
        basicVars[i] = aOff;
        sOff++;
        aOff++;
      } else {
        basicVars[i] = aOff;
        aOff++;
      }
    }

    // ---- Crear tableau inicial ----
    const t0 = this._makeTableauData(mat, basicVars, wRow, cols, rows, null, 'w');
    this.iterations.push({
      phase: 1,
      iteration: 0,
      tableauData: t0,
      pivotCol: null,
      pivotRow: null,
      explanation: 'Tableau inicial de la Fase 1. Minimizando w = Σ variables artificiales.'
    });

    // ---- Iterar ----
    let iterCount = 0;
    const maxIter = 100;

    while (iterCount < maxIter) {
      iterCount++;

      // Encontrar columna pivote (minimización: coeficiente más positivo en w-row)
      const pivotCol = this._findPivotCol(mat[wRow], cols, 'min');
      if (pivotCol === -1) {
        // Óptimo alcanzado
        break;
      }

      // Encontrar fila pivote
      const pivotRow = this._findPivotRow(mat, pivotCol, cols, m);
      if (pivotRow === -1) {
        this.status = 'unbounded';
        this.iterations.push({
          phase: 1,
          iteration: iterCount,
          tableauData: this._makeTableauData(mat, basicVars, wRow, cols, rows, null, 'w'),
          pivotCol,
          pivotRow: null,
          explanation: 'Problema no acotado en Fase 1.'
        });
        return null;
      }

      // Guardar valores pre-pivoteo para la explicación
      const prePivotReduced = mat[wRow][pivotCol];
      const ratios = [];
      for (let i = 0; i < m; i++) {
        if (mat[i][pivotCol] > EPS) {
          ratios.push({ row: i, val: mat[i][cols - 1] / mat[i][pivotCol] });
        }
      }

      // Guardar estado pre-pivoteo para mostrar al usuario
      const preMat = mat.map(row => [...row]);
      const preBasic = [...basicVars];

      // Actualizar básica y pivotear
      basicVars[pivotRow] = pivotCol;
      this._pivot(mat, pivotRow, pivotCol, rows, cols);

      const expl = `Iteración ${iterCount}: Entra ${this.varNames[pivotCol]} (costo reducido = ${fmt(prePivotReduced)}), Sale variable de la fila ${pivotRow + 1} (razón mínima = ${fmtRatio(ratios[0]?.val ?? 0)}).`;

      // Mostrar tableau pre-pivoteo con elementos pivote resaltados
      const td = this._makeTableauData(preMat, preBasic, wRow, cols, rows, null, 'w');

      this.iterations.push({
        phase: 1,
        iteration: iterCount,
        tableauData: td,
        pivotCol,
        pivotRow,
        explanation: expl
      });
    }

    // Verificar optimalidad de Fase 1
    const wVal = mat[wRow][cols - 1];
    if (Math.abs(wVal) > EPS) {
      this.status = 'infeasible';
      this.iterations.push({
        phase: 1,
        iteration: iterCount,
        tableauData: this._makeTableauData(mat, basicVars, wRow, cols, rows, null, 'w'),
        pivotCol: null,
        pivotRow: null,
        explanation: `El problema es INFACTIBLE. w* = ${fmt(wVal)} > 0.`
      });
      return null;
    }

    // Tableau final óptimo de Fase 1 (solo si hubo iteraciones)
    if (iterCount > 0) {
      const tdFinal1 = this._makeTableauData(mat, basicVars, wRow, cols, rows, null, 'w');
      this.iterations.push({
        phase: 1,
        iteration: iterCount,
        tableauData: tdFinal1,
        pivotCol: null,
        pivotRow: null,
        explanation: `Fase 1 completada. w* = 0. Solución básica factible encontrada.`
      });
    }

    return { mat, basicVars, wRow, cols, rows, m, n, slackCount: this.slackCount, artificialCount: this.artificialCount };
  }

  // =================== FASE 2 ================================
  _phase2(phase1Data) {
    const p = this.problem;
    const { mat: p1mat, basicVars, cols, rows, m, n, slackCount, artificialCount } = phase1Data;

    // Crear nuevo tableau sin variables artificiales
    const phase2Cols = cols - artificialCount;
    const phase2Rows = rows; // m restricciones + 1 obj

    const mat2 = Array.from({ length: phase2Rows }, () => new Array(phase2Cols).fill(0));

    // Mapeo de columnas viejas a nuevas (saltando artificiales)
    const oldToNew = [];
    let newIdx = 0;
    const artificialStart = n + slackCount;
    for (let j = 0; j < cols - 1; j++) {
      if (j < artificialStart || j >= artificialStart + artificialCount) {
        oldToNew[j] = newIdx++;
      } else {
        oldToNew[j] = -1; // columna artificial, se descarta
      }
    }
    // Última columna (RHS) siempre se copia
    oldToNew[cols - 1] = phase2Cols - 1;

    // Copiar restricciones (sin artificiales)
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < cols; j++) {
        const nj = oldToNew[j];
        if (nj !== -1) mat2[i][nj] = p1mat[i][j];
      }
    }

    // Actualizar vars básicas (remapear)
    const basicVars2 = basicVars.map(bv => {
      if (bv === -1) return -1;
      const nb = oldToNew[bv];
      return nb !== -1 ? nb : -1;
    });

    // Verificar si alguna básica era artificial (y por tanto se perdió)
    for (let i = 0; i < m; i++) {
      if (basicVars2[i] === -1) {
        // La variable básica era artificial. Buscar un 1 en esta fila para hacerla básica
        for (let j = 0; j < phase2Cols - 1; j++) {
          if (isZero(mat2[i][j] - 1) && !basicVars2.includes(j)) {
            basicVars2[i] = j;
            break;
          }
        }
      }
    }

    // Construir nombres para Fase 2
    const phase2VarNames = [];
    for (let j = 0; j < phase2Cols - 1; j++) {
      // Buscar nombre original
      let found = false;
      for (let k = 0; k < this.varNames.length; k++) {
        if (oldToNew[k] === j) {
          phase2VarNames.push(this.varNames[k]);
          found = true;
          break;
        }
      }
      if (!found) phase2VarNames.push(`y${j + 1}`);
    }

    this.varNamesPhase2 = phase2VarNames;

    // ---- Configurar fila objetivo para Fase 2 ----
    const objRow = phase2Rows - 1;

    // Inicializar con coeficientes de la función objetivo original
    // Para MAX: Z - sum(c_j * x_j) = 0  => coeficientes: -c_j para vars de decisión, 0 para slack
    // Para MIN: Z - sum(c_j * x_j) = 0  => misma forma, las reglas de pivote cambian
    // En nuestro formato: Z + sum(coeff * var) = RHS
    // Para MAX: coeff = -c_j (negativo)
    // Para MIN: coeff = -c_j (negativo) - pero MIN usa reglas de positivo
    // Simplifico: siempre uso coeff = -c_j (el tableau almacena Z - sum(c_j * x_j) = 0)
    // Para MAX: pivote col = más negativo, óptimo cuando todos >= 0
    // Para MIN: pivote col = más positivo, óptimo cuando todos <= 0

    // Inicializar toda la fila objetivo con 0
    for (let j = 0; j < phase2Cols; j++) {
      mat2[objRow][j] = 0;
    }

    // Poner -c_j para variables de decisión
    for (let j = 0; j < n; j++) {
      const nj = oldToNew[j];
      if (nj !== -1) mat2[objRow][nj] = -p.objective[j];
    }

    // Tableau con función objetivo original (antes de reducir)
    const tOrig = this._makeTableauData(mat2, basicVars2, objRow, phase2Cols, phase2Rows, phase2VarNames, 'Z');
    this.iterations.push({
      phase: 2,
      iteration: 0,
      tableauData: tOrig,
      pivotCol: null,
      pivotRow: null,
      explanation: 'Inicio de Fase 2. Se restaura la función objetivo original: Z ' + p.objective.map((c, i) => (c > 0 ? '- ' : '+ ') + Math.abs(c) + this.varNames[i]).join(' ') + ' = 0'
    });

    // Eliminar variables básicas de la fila objetivo
    for (let i = 0; i < m; i++) {
      const bv = basicVars2[i];
      if (bv === -1 || bv >= phase2Cols - 1) continue;
      const coeff = mat2[objRow][bv];
      if (!isZero(coeff)) {
        for (let j = 0; j < phase2Cols; j++) {
          mat2[objRow][j] -= coeff * mat2[i][j];
        }
      }
    }

    // Tableau después de reducir (eliminar básicas de la fila objetivo)
    const t0 = this._makeTableauData(mat2, basicVars2, objRow, phase2Cols, phase2Rows, phase2VarNames, 'Z');
    this.iterations.push({
      phase: 2,
      iteration: 1,
      tableauData: t0,
      pivotCol: null,
      pivotRow: null,
      explanation: 'Se eliminan las variables básicas de la función objetivo para obtener la forma canónica.'
    });

    // ---- Iterar Fase 2 ----
    let iterCount = 1;
    const maxIter = 100;
    const optType = p.type;

    while (iterCount < maxIter) {
      iterCount++;

      const pivotCol = this._findPivotCol(mat2[objRow], phase2Cols, optType);
      if (pivotCol === -1) break;

      const pivotRow = this._findPivotRow(mat2, pivotCol, phase2Cols, m);
      if (pivotRow === -1) {
        this.status = 'unbounded';
        this.iterations.push({
          phase: 2,
          iteration: iterCount,
          tableauData: this._makeTableauData(mat2, basicVars2, objRow, phase2Cols, phase2Rows, phase2VarNames, 'Z'),
          pivotCol,
          pivotRow: null,
          explanation: 'Problema no acotado. La solución es unbounded.'
        });
        return;
      }

      const prePivotReduced = mat2[objRow][pivotCol];
      const ratios = [];
      for (let i = 0; i < m; i++) {
        if (mat2[i][pivotCol] > EPS) {
          ratios.push({ row: i, val: mat2[i][phase2Cols - 1] / mat2[i][pivotCol] });
        }
      }

      const preMat = mat2.map(row => [...row]);
      const preBasic = [...basicVars2];

      basicVars2[pivotRow] = pivotCol;
      this._pivot(mat2, pivotRow, pivotCol, phase2Rows, phase2Cols);

      const dir = optType === 'max' ? 'negativo' : 'positivo';
      const expl = `Iteración ${iterCount}: Entra ${phase2VarNames[pivotCol]} (costo reducido ${dir} = ${fmt(prePivotReduced)}), Sale variable de la fila ${pivotRow + 1} (razón mínima = ${fmtRatio(ratios[0]?.val ?? 0)}).`;

      const td = this._makeTableauData(preMat, preBasic, objRow, phase2Cols, phase2Rows, phase2VarNames, 'Z');
      this.iterations.push({
        phase: 2,
        iteration: iterCount,
        tableauData: td,
        pivotCol,
        pivotRow,
        explanation: expl
      });
    }

    // ---- Extraer solución ----
    this.status = 'optimal';

    // Mostrar tableau final óptimo
    const tdFinal = this._makeTableauData(mat2, basicVars2, objRow, phase2Cols, phase2Rows, phase2VarNames, 'Z');
    this.iterations.push({
      phase: 2,
      iteration: iterCount,
      tableauData: tdFinal,
      pivotCol: null,
      pivotRow: null,
      explanation: 'Tableau final — solución óptima encontrada.'
    });

    this._extractSolution(mat2, basicVars2, objRow, phase2Cols, phase2Rows, phase2VarNames);
  }

  // ================ MÉTODOS AUXILIARES =====================

  _findPivotCol(objRow, cols, optType) {
    if (optType === 'max') {
      // Maximización: columna pivote = la más negativa (excluyendo RHS)
      let minVal = -EPS;
      let minCol = -1;
      for (let j = 0; j < cols - 1; j++) {
        if (objRow[j] < minVal) {
          minVal = objRow[j];
          minCol = j;
        }
      }
      return minCol;
    } else {
      // Minimización: columna pivote = la más positiva
      let maxVal = EPS;
      let maxCol = -1;
      for (let j = 0; j < cols - 1; j++) {
        if (objRow[j] > maxVal) {
          maxVal = objRow[j];
          maxCol = j;
        }
      }
      return maxCol;
    }
  }

  _findPivotRow(mat, pivotCol, cols, m) {
    let minRatio = Infinity;
    let minRow = -1;
    for (let i = 0; i < m; i++) {
      const a = mat[i][pivotCol];
      const b = mat[i][cols - 1];
      if (a > EPS && b >= -EPS) {
        const ratio = b / a;
        if (ratio < minRatio) {
          minRatio = ratio;
          minRow = i;
        }
      }
    }
    return minRow;
  }

  _pivot(mat, pivotRow, pivotCol, rows, cols) {
    const pivotVal = mat[pivotRow][pivotCol];
    if (isZero(pivotVal)) return;

    // Dividir fila pivote por el elemento pivote
    for (let j = 0; j < cols; j++) {
      mat[pivotRow][j] /= pivotVal;
    }

    // Eliminar columna pivote de las demás filas
    for (let i = 0; i < rows; i++) {
      if (i === pivotRow) continue;
      const factor = mat[i][pivotCol];
      if (isZero(factor)) continue;
      for (let j = 0; j < cols; j++) {
        mat[i][j] -= factor * mat[pivotRow][j];
      }
    }
  }

  _makeTableauData(mat, basicVars, objRow, cols, rows, varNamesOverride, objLabel) {
    const names = varNamesOverride || this.varNames;
    const data = {
      headers: [],
      rows: [],
      basicVars: []
    };

    for (let j = 0; j < cols - 1; j++) {
      data.headers.push(names[j] || `v${j + 1}`);
    }
    data.headers.push('RHS');

    for (let i = 0; i < rows; i++) {
      const rowData = [];
      for (let j = 0; j < cols; j++) {
        rowData.push(mat[i][j]);
      }
      data.rows.push(rowData);
      if (i < rows - 1) {
        const bv = basicVars[i];
        data.basicVars.push(bv !== -1 ? (names[bv] || `v${bv + 1}`) : '-');
      } else {
        data.basicVars.push(objLabel || 'Z');
      }
    }

    return data;
  }

  _extractSolution(mat, basicVars, objRow, cols, rows, varNames) {
    const sol = {};
    const m = rows - 1;
    const n = cols - 1;

    // Inicializar todas las variables en 0
    for (let j = 0; j < n; j++) {
      sol[varNames[j]] = 0;
    }

    // Extraer variables básicas
    for (let i = 0; i < m; i++) {
      const bv = basicVars[i];
      if (bv !== -1 && bv < n) {
        sol[varNames[bv]] = mat[i][cols - 1];
      }
    }

    // Valor óptimo
    let optVal = mat[objRow][cols - 1];
    // Para max: Z está en la forma Z - sum(c_j * x_j) = RHS, Z = RHS
    // Para min: misma forma, Z = RHS
    // Pero si el tipo es min, y usamos -c_j, entonces Z = RHS también
    // El signo del valor óptimo es correcto

    this.solution = sol;
    this.optimalValue = optVal;
  }

  // ================ VERIFICAR OPTIMALIDAD ====================
  isOptimal() {
    return this.status === 'optimal';
  }
}

// ===================== UI ===================================
class SimplexUI {
  constructor() {
    this.solver = null;
    this._bindEvents();
  }

  _bindEvents() {
    document.getElementById('generate-btn').addEventListener('click', () => this._generateInput());
    document.getElementById('solve-btn').addEventListener('click', () => this._solve());
    document.getElementById('reset-btn').addEventListener('click', () => this._reset());
  }

  _generateInput() {
    const numVars = parseInt(document.getElementById('num-vars').value);
    const numConstraints = parseInt(document.getElementById('num-constraints').value);
    const optType = document.getElementById('opt-type').value;

    if (numVars < 1 || numConstraints < 1) {
      this._showError('Debe haber al menos 1 variable y 1 restricción.');
      return;
    }

    if (numVars > 20 || numConstraints > 20) {
      this._showError('Máximo 20 variables y 20 restricciones.');
      return;
    }

    document.getElementById('input-section').classList.remove('hidden');
    document.getElementById('results-section').classList.add('hidden');
    document.getElementById('error-msg').classList.add('hidden');

    this._buildProblemForm(numVars, numConstraints, optType);
  }

  _buildProblemForm(numVars, numConstraints, optType) {
    const container = document.getElementById('problem-input');
    const optLabel = optType === 'max' ? 'Maximizar' : 'Minimizar';

    let html = `
      <div style="margin-bottom: 0.8rem; font-size: 0.9rem; color: #4a5568;">
        Problema con <strong>${numVars}</strong> variables de decisión y <strong>${numConstraints}</strong> restricciones. Tipo: <strong>${optLabel}</strong>.
      </div>
      <table class="problem-table">
        <thead>
          <tr>
            <th></th>`;

    for (let j = 0; j < numVars; j++) {
      html += `<th>x<sub>${j + 1}</sub></th>`;
    }
    html += `<th>Signo</th><th>RHS</th></tr></thead><tbody>`;

    // Fila de función objetivo
    html += `<tr><td class="obj-label">${optLabel === 'Maximizar' ? 'Máx Z' : 'Mín Z'}</td>`;
    for (let j = 0; j < numVars; j++) {
      html += `<td><input type="number" class="coeff-input" id="obj-coeff-${j}" step="any" value="${j === 0 ? '3' : j === 1 ? '5' : '0'}"></td>`;
    }
    html += `<td></td><td></td></tr>`;

    // Filas de restricciones
    for (let i = 0; i < numConstraints; i++) {
      html += `<tr><td class="constr-label">Restricción ${i + 1}</td>`;
      for (let j = 0; j < numVars; j++) {
        let defaultVal;
        if (i === 0 && j === 0) defaultVal = '1';
        else if (i === 1 && j === 1) defaultVal = '2';
        else if (i === 2 && j === 0) defaultVal = '3';
        else if (i === 2 && j === 1) defaultVal = '2';
        else defaultVal = '0';
        html += `<td><input type="number" class="coeff-input" id="constr-${i}-coeff-${j}" step="any" value="${defaultVal}"></td>`;
      }
      html += `<td>
        <select class="sign-select" id="constr-${i}-sign">
          <option value="<=" ${i === 0 || i === 1 ? 'selected' : ''}>≤</option>
          <option value="=" ${i === 2 ? 'selected' : ''}>=</option>
          <option value=">=">≥</option>
        </select>
      </td>`;
      html += `<td><input type="number" class="coeff-input" id="constr-${i}-rhs" step="any" value="${i === 0 ? '4' : i === 1 ? '12' : '18'}"></td>`;
      html += `</tr>`;
    }

    html += `</tbody></table>`;
    container.innerHTML = html;
  }

  _getProblem() {
    const numVars = parseInt(document.getElementById('num-vars').value);
    const numConstraints = parseInt(document.getElementById('num-constraints').value);
    const optType = document.getElementById('opt-type').value;

    const objective = [];
    for (let j = 0; j < numVars; j++) {
      const val = parseFloat(document.getElementById(`obj-coeff-${j}`).value);
      if (isNaN(val)) { this._showError(`Coeficiente de x${j + 1} no válido.`); return null; }
      objective.push(val);
    }

    const constraints = [];
    for (let i = 0; i < numConstraints; i++) {
      const coeffs = [];
      for (let j = 0; j < numVars; j++) {
        const val = parseFloat(document.getElementById(`constr-${i}-coeff-${j}`).value);
        if (isNaN(val)) { this._showError(`Coeficiente de restricción ${i + 1}, x${j + 1} no válido.`); return null; }
        coeffs.push(val);
      }
      const sign = document.getElementById(`constr-${i}-sign`).value;
      const rhs = parseFloat(document.getElementById(`constr-${i}-rhs`).value);
      if (isNaN(rhs)) { this._showError(`RHS de restricción ${i + 1} no válido.`); return null; }
      constraints.push({ coeffs, sign, rhs });
    }

    return new Problem(optType, objective, constraints);
  }

  _solve() {
    const problem = this._getProblem();
    if (!problem) return;

    document.getElementById('error-msg').classList.add('hidden');

    this.solver = new TwoPhaseSimplex(problem);
    this.solver.solve();

    this._renderResults();
  }

  _renderResults() {
    const container = document.getElementById('results-content');
    const section = document.getElementById('results-section');
    section.classList.remove('hidden');

    let html = '';

    const iterations = this.solver.iterations;
    let phase1Iters = iterations.filter(it => it.phase === 1);
    let phase2Iters = iterations.filter(it => it.phase === 2);

    // FASE 1
    if (phase1Iters.length > 0) {
      html += `<h3 class="phase-title phase-1">Fase 1 — Minimización de variables artificiales</h3>`;
      for (const it of phase1Iters) {
        html += this._renderIteration(it);
      }
    }

    // Estado infactible
    if (this.solver.status === 'infeasible') {
      html += `<div class="msg msg-error">El problema es INFACTIBLE. No existe solución que satisfaga todas las restricciones.</div>`;
      container.innerHTML = html;
      this._scrollToResults();
      return;
    }

    // FASE 2
    if (phase2Iters.length > 0) {
      html += `<h3 class="phase-title phase-2">Fase 2 — Optimización de la función objetivo original</h3>`;
      for (const it of phase2Iters) {
        html += this._renderIteration(it);
      }
    }

    if (this.solver.status === 'unbounded') {
      html += `<div class="msg msg-warning">El problema es NO ACOTADO. La solución tiende a infinito.</div>`;
    } else if (this.solver.status === 'optimal') {
      html += this._renderSolution();
    }

    container.innerHTML = html;
    this._scrollToResults();
  }

  _renderIteration(it) {
    let html = `<div class="iteration-card">`;
    html += `<h4>Iteración ${it.iteration}</h4>`;

    if (it.explanation) {
      html += `<div class="pivot-info">${it.explanation}</div>`;
    }

    html += `<div class="tableau-wrapper"><table class="tableau"><thead><tr><th>Base</th>`;
    const td = it.tableauData;
    for (const h of td.headers) {
      html += `<th>${h}</th>`;
    }
    html += `</tr></thead><tbody>`;

    for (let i = 0; i < td.rows.length; i++) {
      const isObj = i === td.rows.length - 1;
      html += `<tr class="${isObj ? 'obj-row' : ''}">`;
      html += `<td class="basic-var">${td.basicVars[i]}</td>`;

      for (let j = 0; j < td.rows[i].length; j++) {
        const isPivotCol = j === it.pivotCol;
        const isPivotRow = i === it.pivotRow;
        const isPivotEl = isPivotCol && isPivotRow;
        const isRHS = j === td.rows[i].length - 1;

        let cls = '';
        if (isPivotEl) cls = 'pivot-el';
        else if (isPivotCol) cls = 'pivot-col';
        else if (isPivotRow) cls = 'pivot-row';
        if (isRHS) cls += ' rhs-col';

        html += `<td class="${cls}">${fmt(td.rows[i][j])}</td>`;
      }
      html += `</tr>`;
    }

    html += `</tbody></table></div></div>`;
    return html;
  }

  _renderSolution() {
    const sol = this.solver.solution;
    const optVal = this.solver.optimalValue;
    const optType = this.solver.problem.type;
    const label = optType === 'max' ? 'Máx Z' : 'Mín Z';

    let html = `<div class="card">`;
    html += `<h3>Solución Óptima</h3>`;
    html += `<div class="msg msg-success">El problema ha sido resuelto exitosamente.</div>`;
    html += `<div class="solution-grid">`;

    for (const [name, val] of Object.entries(sol)) {
      if (name.startsWith('s') || name.startsWith('r')) continue;
      html += `<div class="solution-item">
        <div class="var-name">${name}</div>
        <div class="var-value positive">${fmt(val)}</div>
      </div>`;
    }

    html += `<div class="solution-item" style="background: #ecfdf5; border-color: #6ee7b7;">
      <div class="var-name">${label}</div>
      <div class="var-value positive">${fmt(optVal)}</div>
    </div>`;

    html += `</div>`;
    html += `</div>`;
    return html;
  }

  _showError(msg) {
    const el = document.getElementById('error-msg');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  _reset() {
    document.getElementById('input-section').classList.add('hidden');
    document.getElementById('results-section').classList.add('hidden');
    document.getElementById('error-msg').classList.add('hidden');
    document.getElementById('problem-input').innerHTML = '';
    this.solver = null;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  _scrollToResults() {
    setTimeout(() => {
      document.getElementById('results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }
}

// ===================== INICIALIZACIÓN =======================
document.addEventListener('DOMContentLoaded', () => {
  new SimplexUI();
});
