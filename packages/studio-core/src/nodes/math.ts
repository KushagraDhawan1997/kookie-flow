import { defineNode, socket } from '../define';

const binary = (
  name: string,
  label: string,
  description: string,
  f: (a: number, b: number) => number,
  defaults: [number, number] = [0, 0]
) =>
  defineNode({
    type: `math/${name}`,
    label,
    category: 'math',
    description,
    inputs: {
      a: socket('float', { widget: 'number', default: defaults[0] }),
      b: socket('float', { widget: 'number', default: defaults[1] }),
    },
    outputs: { out: socket('float') },
    where: 'inline',
    run: ({ a, b }) => ({ out: f(a, b) }),
  });

export const add = binary('add', 'Add', 'a + b.', (a, b) => a + b);
export const subtract = binary('subtract', 'Subtract', 'a − b.', (a, b) => a - b);
export const multiply = binary('multiply', 'Multiply', 'a × b.', (a, b) => a * b, [1, 1]);
export const divide = binary('divide', 'Divide', 'a ÷ b. Division by zero gives 0.', (a, b) => (b === 0 ? 0 : a / b), [1, 1]);
export const power = binary('power', 'Power', 'a to the power b.', (a, b) => Math.pow(a, b), [1, 1]);
export const min = binary('min', 'Min', 'The smaller of a and b.', Math.min);
export const max = binary('max', 'Max', 'The larger of a and b.', Math.max);

export const remap = defineNode({
  type: 'math/remap',
  label: 'Remap',
  category: 'math',
  description: 'Map a value from one range to another. 0.5 in 0..1 becomes 50 in 0..100.',
  inputs: {
    value: socket('float', { widget: 'number', default: 0 }),
    inMin: socket('float', { label: 'In min', widget: 'number', default: 0 }),
    inMax: socket('float', { label: 'In max', widget: 'number', default: 1 }),
    outMin: socket('float', { label: 'Out min', widget: 'number', default: 0 }),
    outMax: socket('float', { label: 'Out max', widget: 'number', default: 100 }),
  },
  outputs: { out: socket('float') },
  where: 'inline',
  run: ({ value, inMin, inMax, outMin, outMax }) => {
    const t = inMax === inMin ? 0 : (value - inMin) / (inMax - inMin);
    return { out: outMin + t * (outMax - outMin) };
  },
});

export const clamp = defineNode({
  type: 'math/clamp',
  label: 'Clamp',
  category: 'math',
  description: 'Keep a value between min and max.',
  inputs: {
    value: socket('float', { widget: 'number', default: 0 }),
    min: socket('float', { widget: 'number', default: 0 }),
    max: socket('float', { widget: 'number', default: 1 }),
  },
  outputs: { out: socket('float') },
  where: 'inline',
  run: ({ value, min, max }) => ({ out: Math.min(max, Math.max(min, value)) }),
});

export const round = defineNode({
  type: 'math/round',
  label: 'Round',
  category: 'math',
  description: 'Round to the nearest whole number, or to a number of decimals.',
  inputs: {
    value: socket('float', { widget: 'number', default: 0 }),
    decimals: socket('int', { default: 0, min: 0, max: 6 }),
  },
  outputs: { out: socket('float') },
  where: 'inline',
  run: ({ value, decimals }) => {
    const f = Math.pow(10, decimals);
    return { out: Math.round(value * f) / f };
  },
});

/**
 * A small expression evaluator: numbers, a b c d, + - * / % ^, parentheses, and the functions
 * below. No `eval`, so an expression from a saved graph or an agent cannot run code.
 */
const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  atan2: Math.atan2,
  exp: Math.exp,
  log: Math.log,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  mix: (a, b, t) => a + (b - a) * t,
  clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  step: (edge, x) => (x < edge ? 0 : 1),
  smoothstep: (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  },
};

/**
 * How many arguments each function takes. Without the check, `sqrt()` and `mix(1, 2)` quietly
 * produce NaN, which then travels the whole graph as a number that renders as nothing.
 * `min` and `max` are variadic and take at least one.
 */
const ARITY: Record<string, number | 'variadic'> = {
  abs: 1, floor: 1, ceil: 1, round: 1, sqrt: 1, sin: 1, cos: 1, tan: 1, exp: 1, log: 1,
  atan2: 2, pow: 2, step: 2,
  mix: 3, clamp: 3, smoothstep: 3,
  min: 'variadic', max: 'variadic',
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

type Token = { kind: 'num'; value: number } | { kind: 'id'; value: string } | { kind: 'op'; value: string };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const re = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?)|([a-zA-Z_]\w*)|([-+*/%^(),]))/y;
  let i = 0;
  while (i < src.length) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m || m[0].length === 0) {
      if (/^\s*$/.test(src.slice(i))) break;
      throw new Error(`unexpected "${src[i]}" at ${i}`);
    }
    i = re.lastIndex;
    if (m[1] !== undefined) tokens.push({ kind: 'num', value: Number(m[1]) });
    else if (m[2] !== undefined) tokens.push({ kind: 'id', value: m[2] });
    else if (m[3] !== undefined) tokens.push({ kind: 'op', value: m[3] });
  }
  return tokens;
}

export function evaluateExpression(src: string, vars: Record<string, number>): number {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const take = () => tokens[pos++];
  const expectOp = (v: string) => {
    const t = take();
    if (!t || t.kind !== 'op' || t.value !== v) throw new Error(`expected "${v}"`);
  };

  const primary = (): number => {
    const t = take();
    if (!t) throw new Error('unexpected end');
    if (t.kind === 'num') return t.value;
    if (t.kind === 'id') {
      const next = peek();
      if (next && next.kind === 'op' && next.value === '(') {
        take();
        const args: number[] = [];
        if (!(peek()?.kind === 'op' && peek()?.value === ')')) {
          args.push(expr());
          while (peek()?.kind === 'op' && peek()?.value === ',') {
            take();
            args.push(expr());
          }
        }
        expectOp(')');
        // `hasOwn`, not `in`: every object inherits `constructor`, `toString` and the rest, and
        // through `in` those names passed as functions and as variables.
        if (!Object.hasOwn(FUNCTIONS, t.value)) throw new Error(`unknown function ${t.value}`);
        const arity = ARITY[t.value];
        if (arity === 'variadic') {
          if (args.length === 0) throw new Error(`${t.value} needs at least one number`);
        } else if (arity !== args.length) {
          throw new Error(`${t.value} takes ${arity} ${arity === 1 ? 'number' : 'numbers'}, got ${args.length}`);
        }
        return (FUNCTIONS[t.value] as (...a: number[]) => number)(...args);
      }
      if (Object.hasOwn(vars, t.value)) return vars[t.value] as number;
      if (Object.hasOwn(CONSTANTS, t.value)) return CONSTANTS[t.value] as number;
      throw new Error(`unknown name ${t.value}`);
    }
    if (t.value === '(') {
      const v = expr();
      expectOp(')');
      return v;
    }
    throw new Error(`unexpected "${t.value}"`);
  };
  // Unary minus binds looser than `^`, so `-a ^ 2` is `-(a ^ 2)` as in every calculator; the
  // exponent itself may carry a sign, so `2 ^ -1` is a half.
  const unary = (): number => {
    const t = peek();
    if (t?.kind === 'op' && t.value === '-') {
      take();
      return -unary();
    }
    if (t?.kind === 'op' && t.value === '+') {
      take();
      return unary();
    }
    return power();
  };
  const power = (): number => {
    const base = primary();
    if (peek()?.kind === 'op' && peek()?.value === '^') {
      take();
      return Math.pow(base, unary());
    }
    return base;
  };
  const term = (): number => {
    let v = unary();
    for (;;) {
      const t = peek();
      if (t?.kind === 'op' && (t.value === '*' || t.value === '/' || t.value === '%')) {
        take();
        const r = unary();
        // Dividing by zero answers 0 here, as the Divide node does, rather than travelling on
        // as Infinity or NaN. The remainder follows the same rule for the same reason.
        v = t.value === '*' ? v * r : r === 0 ? 0 : t.value === '/' ? v / r : v % r;
      } else return v;
    }
  };
  const expr = (): number => {
    let v = term();
    for (;;) {
      const t = peek();
      if (t?.kind === 'op' && (t.value === '+' || t.value === '-')) {
        take();
        const r = term();
        v = t.value === '+' ? v + r : v - r;
      } else return v;
    }
  };
  const result = expr();
  if (pos !== tokens.length) throw new Error('unexpected trailing input');
  return result;
}

export const expression = defineNode({
  type: 'math/expression',
  label: 'Expression',
  category: 'math',
  description:
    'A formula over a, b, c and d: "a * 2 + sin(b)". Functions: abs floor ceil round sqrt sin cos tan atan2 exp log min max pow mix clamp step smoothstep; constants pi e tau.',
  inputs: {
    expr: socket('text', { label: 'Formula', widget: 'text', default: 'a + b', layout: 'stacked' }),
    a: socket('float', { widget: 'number', default: 0 }),
    b: socket('float', { widget: 'number', default: 0 }),
    c: socket('float', { widget: 'number', default: 0 }),
    d: socket('float', { widget: 'number', default: 0 }),
  },
  outputs: { out: socket('float') },
  where: 'inline',
  width: 260,
  run: ({ expr, a, b, c, d }) => ({ out: evaluateExpression(expr, { a, b, c, d }) }),
});
