// The tools the assistant may ask for. The service only describes them to the model;
// the site itself carries them out in the visitor's browser, with the same calls
// the screens use. Write tools are offered only after the owner passcode.

const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const int = (description) => ({ type: 'integer', description });
const bool = (description) => ({ type: 'boolean', description });
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

const OPTION_TYPE = { type: 'string', enum: ['european', 'asian', 'digital', 'barrier', 'lookback', 'range'], description: 'Option type.' };
const BARRIER_TYPE = { type: 'string', enum: ['up_and_in', 'up_and_out', 'down_and_in', 'down_and_out'], description: 'Barrier kind, for barrier options only.' };
const DATE = 'Date as YYYY-MM-DD.';

export const READ_TOOLS = [
  {
    name: 'get_underlyings',
    description: 'Stocks in the app with their latest close, day change, 52-week range and the volatility the engine uses. Without arguments it returns all of them (about 50 rows); pass symbols or a search text to narrow it.',
    input_schema: obj({
      symbols: { type: 'array', items: { type: 'string' }, description: 'Exact tickers, for example ["NVDA","AAPL"].' },
      query: str('Text to find in the ticker or company name.'),
    }),
  },
  {
    name: 'get_price_history',
    description: 'Daily closes of one underlying over a period, sampled to at most 60 points, with the return, high, low and realized volatility of that period. Default period: the last year.',
    input_schema: obj({ symbol: str('Ticker.'), from: str('Start. ' + DATE), to: str('End. ' + DATE) }, ['symbol']),
  },
  {
    name: 'get_derivatives',
    description: 'Option contracts in the app: terms, days to expiry, net position, and the unit value from the latest whole-book valuation. Filter by underlying ticker, option type or a text in the symbol or name.',
    input_schema: obj({ underlying: str('Ticker of the underlying.'), type: OPTION_TYPE, query: str('Text to find in the contract symbol or name.') }),
  },
  {
    name: 'get_trades',
    description: 'Trades in the book with quantity (negative means sold), price paid per unit, premium, and current unit value, market value and profit or loss from the latest whole-book valuation. Filter by underlying ticker, instrument symbol or trade-date range.',
    input_schema: obj({
      underlying: str('Ticker of the underlying.'),
      instrument: str('Exact symbol of the contract or stock traded.'),
      from: str('Earliest trade date. ' + DATE),
      to: str('Latest trade date. ' + DATE),
    }),
  },
  {
    name: 'get_book',
    description: 'The whole book in one view from the latest valuation as of now: totals (open trades, net premium paid, market value, profit or loss) and the same split by underlying.',
    input_schema: obj({}),
  },
  {
    name: 'get_rate_curves',
    description: 'Rate curves in the app. Without a name it lists every curve with its kind (live, snapshot, scenario, user) and key tenors. With a name (or part of one) it returns all points of the matching curves. Rates are decimals: 0.051 is 5.10%.',
    input_schema: obj({ name: str('Curve name or part of it, for example "2026-10-30" or "Scenario +100".') }),
  },
  {
    name: 'run_valuation',
    description: 'Run the Monte Carlo valuation on trades. Returns totals for the selection (value, its standard error, and the position Greeks vega_1pt, theta_1d, rho_100bp), the same by underlying with delta_shares, and one row per trade. Choose the trades by ids, by underlying, by instrument, or leave all three out for the whole book. Optional: a past valuation date (uses closes up to that day and leaves out trades made later), a rate curve by name (leave out for the live curve), and simulation settings. Takes a few seconds.',
    input_schema: obj({
      trade_ids: { type: 'array', items: { type: 'integer' }, description: 'Trade ids to value.' },
      underlying: str('Value only trades on this underlying ticker.'),
      instrument: str('Value only trades in this instrument symbol.'),
      as_of: str('Valuation date in the past. ' + DATE + ' Leave out for now.'),
      curve: str('Rate curve name or part of it. Leave out for the live curve.'),
      paths: int('Simulation paths, 1000 to 20000. Default 5000.'),
      steps: int('Time steps per path, 1 to 252. Default 64.'),
      antithetic: bool('Antithetic paths. Default true.'),
      control_variate: bool('Control variate. Default false.'),
    }),
  },
  {
    name: 'price_option',
    description: 'Price one hypothetical option with the Monte Carlo engine without saving anything: a what-if. Give the underlying ticker (spot, volatility and rate are then taken from the app data) or give spot yourself; any input you pass overrides the default. Returns price, standard error, Greeks per unit (vega_1pt, theta_1d, rho_100bp) and the inputs used.',
    input_schema: obj(
      {
        underlying: str('Ticker to take spot and volatility from.'),
        spot: num('Spot price. Default: last close of the underlying.'),
        strike: num('Strike price. Not used by range options.'),
        strike_pct: num('Strike as a percent of spot instead of a price: 105 is 5% above spot, 95 is 5% below. Use it for "5% out of the money" so you do not compute the strike yourself.'),
        expiry: str('Expiry date. ' + DATE + ' Give this or years.'),
        years: num('Time to expiry in years. Give this or expiry.'),
        type: OPTION_TYPE,
        call: bool('True for a call, false for a put.'),
        volatility: num('Annual volatility as a decimal, 0.35 for 35%. Default: the underlying history.'),
        rate: num('Risk-free rate as a decimal. Default: the curve point nearest to the time left.'),
        curve: str('Rate curve name to take the rate from. Default: the live curve.'),
        barrier: num('Barrier level, for barrier options.'),
        barrier_type: BARRIER_TYPE,
        rebate: num('Fixed payout, for digital options.'),
        paths: int('Simulation paths, 1000 to 20000. Default 10000.'),
        steps: int('Time steps per path, 1 to 252. Default 64.'),
      },
      ['type', 'call'],
    ),
  },
  {
    name: 'open_screen',
    description: 'Bring a screen of the app up for the person, optionally on one stock or contract, so they can see what you are describing. Changes nothing in the data. Screens: underlyings (price chart and watchlist), derivatives (contract list), trades (blotter with value and profit or loss per trade), rates (curve charts), valuation (run settings, value by underlying, Greeks per trade), overview (the about page on how the app is built, not a portfolio summary).',
    input_schema: obj(
      {
        screen: { type: 'string', enum: ['underlyings', 'derivatives', 'trades', 'rates', 'valuation', 'overview'], description: 'Screen to show.' },
        symbol: str('Stock ticker (underlyings screen) or contract symbol (derivatives screen) to select.'),
      },
      ['screen'],
    ),
  },
];

export const WRITE_TOOLS = [
  {
    name: 'create_underlying',
    description: 'Add a user underlying with its daily closes (at least three, so a volatility exists).',
    input_schema: obj(
      {
        symbol: str('Ticker, letters, digits, dot, dash or underscore.'),
        name: str('Display name.'),
        closes: { type: 'array', minItems: 3, items: obj({ date: str(DATE), price: num('Close, above zero.') }, ['date', 'price']), description: 'Daily closes.' },
      },
      ['symbol', 'name', 'closes'],
    ),
  },
  {
    name: 'rename_underlying',
    description: 'Change the display name of a user underlying. Predefined stocks cannot be changed.',
    input_schema: obj({ symbol: str('Ticker of the underlying.'), name: str('New display name.') }, ['symbol', 'name']),
  },
  {
    name: 'delete_underlying',
    description: 'Delete a user underlying and its closes, together with trades made directly in it. Not possible while it still has derivatives, and never for predefined stocks.',
    input_schema: obj({ symbol: str('Ticker of the underlying.') }, ['symbol']),
  },
  {
    name: 'create_derivative',
    description: 'Add an option contract on an underlying.',
    input_schema: obj(
      {
        symbol: str('Contract symbol, for example AAPL-19MAR27-340-C.'),
        name: str('Display name.'),
        underlying: str('Ticker of the underlying.'),
        type: OPTION_TYPE,
        call: bool('True for a call, false for a put.'),
        strike: num('Strike price. Use 0 for range options.'),
        expiry: str('Expiry date. ' + DATE),
        barrier: num('Barrier level, for barrier options.'),
        barrier_type: BARRIER_TYPE,
        rebate: num('Fixed payout, for digital options.'),
      },
      ['symbol', 'name', 'underlying', 'type', 'call', 'strike', 'expiry'],
    ),
  },
  {
    name: 'update_derivative',
    description: 'Change terms of an existing contract. Only pass what changes. The option type cannot change.',
    input_schema: obj(
      {
        symbol: str('Current contract symbol.'),
        new_symbol: str('New contract symbol.'),
        name: str('New display name.'),
        call: bool('True for a call, false for a put.'),
        strike: num('New strike.'),
        expiry: str('New expiry. ' + DATE),
        barrier: num('New barrier level.'),
        barrier_type: BARRIER_TYPE,
        rebate: num('New fixed payout.'),
      },
      ['symbol'],
    ),
  },
  {
    name: 'delete_derivative',
    description: 'Delete a contract. Its trades are deleted with it.',
    input_schema: obj({ symbol: str('Contract symbol.') }, ['symbol']),
  },
  {
    name: 'create_trade',
    description: 'Add a trade in a contract or a stock. Quantity is signed: positive buys, negative sells. Give a price per unit, or set use_model_price to price it with the engine as of the trade date.',
    input_schema: obj(
      {
        instrument: str('Symbol of the contract or stock.'),
        quantity: num('Units, negative to sell. Not zero.'),
        trade_date: str('Trade date. ' + DATE),
        price: num('Price per unit.'),
        use_model_price: bool('Price per unit from the engine as of the trade date. Contracts only.'),
      },
      ['instrument', 'quantity', 'trade_date'],
    ),
  },
  {
    name: 'update_trade',
    description: 'Change quantity, date or price of an existing trade. Only pass what changes.',
    input_schema: obj({ id: int('Trade id.'), quantity: num('New signed quantity.'), trade_date: str('New trade date. ' + DATE), price: num('New price per unit.') }, ['id']),
  },
  {
    name: 'delete_trade',
    description: 'Delete one trade from the book, by its id.',
    input_schema: obj({ id: int('Trade id.') }, ['id']),
  },
  {
    name: 'create_rate_curve',
    description: 'Add a user rate curve. Each point is a tenor in years and a rate as a decimal (0.045 for 4.5%).',
    input_schema: obj(
      {
        name: str('Curve name.'),
        points: { type: 'array', minItems: 1, items: obj({ tenor: num('Tenor in years.'), rate: num('Rate as a decimal.') }, ['tenor', 'rate']), description: 'Curve points.' },
      },
      ['name', 'points'],
    ),
  },
  {
    name: 'rename_rate_curve',
    description: 'Rename a user rate curve. The Treasury curves cannot be changed.',
    input_schema: obj({ name: str('Current curve name.'), new_name: str('New curve name.') }, ['name', 'new_name']),
  },
  {
    name: 'delete_rate_curve',
    description: 'Delete a user rate curve. The Treasury curves cannot be deleted.',
    input_schema: obj({ name: str('Curve name.') }, ['name']),
  },
];

export const READ_NAMES = new Set(READ_TOOLS.map((t) => t.name));
export const WRITE_NAMES = new Set(WRITE_TOOLS.map((t) => t.name));

export function toolsFor(owner) {
  return owner ? READ_TOOLS.concat(WRITE_TOOLS) : READ_TOOLS;
}
