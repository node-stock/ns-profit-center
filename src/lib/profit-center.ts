import { Store as db, Account } from 'ns-store';
import { InfluxDB } from 'ns-influxdb';
import { ISequelizeConfig } from 'sequelize-typescript';
import { AccountManager } from 'ns-manager';
import { Log, Util } from 'ns-common';

const config = require('config');
Log.init(Log.category.system, Log.level.ALL, 'ns-profit-center');
db.init(config.store);
/**
  * @class
  * @classdesc 利润控制器
  */
export class ProfitCenter {
  influxdb: InfluxDB;

  constructor() {
    this.influxdb = new InfluxDB(config.influxdb);
  }

  /**
   * 监视盈亏(Profit/Loss)情报
   */
  async watchPL() {
    const accountList = await AccountManager.getAll();
    if (!accountList || accountList.length === 0) {
      Log.system.console.warn('用户列表为空，不执行利润控制器！');
      return;
    }
    for (const accoount of accountList) {
      if (accoount.positions && accoount.positions.length > 0) {

        for (const position of accoount.positions) {
          const lastPrice = await this.getLastPrice(position.symbol);
          if (lastPrice / <number>position.price <= 0.9) {
            // 止损出局
          } else if (lastPrice / <number>position.price >= 1.1) {
            // 止盈出局
          }
        }
      }
    }
  }

  async lockPosition() {

    const accountList = await AccountManager.getAll();
    if (!accountList || accountList.length === 0) {
      Log.system.console.warn('用户列表为空，不执行锁仓！');
      return;
    }
    for (const accoount of accountList) {
      if (accoount.balance === 0) {
        // 自动锁仓
      }
    }
  }

  async getLastPrice(symbol: string) {
    const res = await this.influxdb.connection.query(`
      SELECT LAST(price) from tick where symbol='${symbol}'`);
    console.log(res);
    return 123;
  }
}
