import BetterSqlite3 from 'better-sqlite3'

// WorkBuddy Desktop currently ships a Node build older than node:sqlite's
// supported baseline. The plugin bundle aliases node:sqlite to this compatible
// constructor while leaving the StrataGate core package unchanged.
export class DatabaseSync extends BetterSqlite3 {
  constructor(filename: string, options: { readOnly?: boolean; timeout?: number } = {}) {
    super(filename, {
      readonly: options.readOnly ?? false,
      timeout: options.timeout,
    })
  }
}
