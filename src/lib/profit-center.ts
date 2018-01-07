import { Store as db, Account } from 'ns-store';
import { AccountManager } from 'ns-manager';
import { Log, Util } from 'ns-common';
import { Calc } from 'ns-calc';
import { SlackAlerter } from 'ns-alerter';
import { Bitbank, BitbankApiAsset } from 'bitbank-handler';
import { BigNumber } from 'BigNumber.js';

import * as types from 'ns-types';
import * as fetch from 'isomorphic-fetch';
import * as assert from 'power-assert';
import * as moment from 'moment';

const config = require('config');
Log.init(Log.category.system, Log.level.ALL, 'ns-profit-center');
db.init(config.store);
/**
  * @class
  * @classdesc 利润控制器
  */
export class ProfitCenter {
  // 实时监测间隔
  interval: number;
  worker: number = 0;
  bitbank: Bitbank;
  accounts: types.ConfigAccount[];

  constructor() {
    assert(config, 'config required for ProfitCenter');
    assert(config.pc, 'config.pc required for ProfitCenter');
    assert(config.accounts, 'config.accounts required for ProfitCenter');
    assert(config.trader, 'config.trader required for ProfitCenter');
    this.interval = config.pc.interval;
    this.accounts = config.accounts;
    this.bitbank = new Bitbank({
      apiKey: config.trader.apiKey,
      apiSecret: config.trader.secret
    });
  }

  async destroy() {
    clearInterval(this.worker);
  }

  async start() {
    Log.system.info('启动利润中心检测程序...');
    // await this.onPretrade();
    this.worker = setInterval(this.watchPL.bind(this), this.interval);
  }

  /**
   * 监视盈亏(Profit/Loss)情报
   */
  async watchPL() {
    Log.system.info('监视盈亏[启动]');

    for (const acc of this.accounts) {
      const account = await AccountManager.get(acc.bitbank.id);
      Log.system.info('账户：', JSON.stringify(account, null, 2));
      if (account && account.positions && account.positions.length > 0) {

        for (const position of account.positions) {
          const lastAveragePrice = await this.getLastAveragePrice(position.symbol);
          if (!lastAveragePrice) {
            Log.system.warn(`未获得持仓商品(${position.symbol})的最近平均价(${lastAveragePrice}),跳出本次执行。`);
            continue;
          }
          const lastPrice = new BigNumber(lastAveragePrice);
          const stopLossPrice = Calc.stopLoss(position.symbol, lastPrice.toFixed());
          // 最新价格 <= 止损价
          if (lastPrice.lessThanOrEqualTo(stopLossPrice)) {
            Log.system.info(`持仓：${JSON.stringify(position, null, 2)}`);
            Log.system.info(`最新价格(${lastPrice.toFixed()}) <= 止损价(${stopLossPrice}),执行止损单！`);
            const asset = await this.getAsset(account, position);
            // 未查询出商品 
            if (!asset) {
              Log.system.error(`未查询出持仓商品:${asset}, 退出本次处理。`);
              continue;
            }
            if (new BigNumber(asset.free_amount).isZero()) {
              Log.system.error(`持仓商品空余量:${asset.free_amount}, 退出本次处理。`);
              continue;
            }
            // 持仓数量 > 真实空余量
            let quantity = position.quantity
            if (new BigNumber(quantity).greaterThan(asset.free_amount)) {
              Log.system.error(`持仓数量(${quantity}) > 真实空余量(${asset.free_amount}), 使用真实空余量卖出。`);
              quantity = asset.free_amount;
            }
            // 卖出止损单
            const order: types.Order = {
              account_id: position.account_id,
              price: stopLossPrice,
              symbol: position.symbol,
              symbolType: types.SymbolType.cryptocoin,
              orderType: types.OrderType.StopLimit,
              tradeType: types.TradeType.Spot,
              side: types.OrderSide.BuyClose,
              amount: quantity,
              eventType: types.EventType.Order,
              backtest: position.backtest
            };
            Log.system.info(`卖出止损单${JSON.stringify(order)}`);
            await this.postOrder(order);
            await SlackAlerter.sendOrder(order);
          }
        }
      }
    }
    Log.system.info('监视盈亏[终了]');
  }

  async lockPosition() {

    const accountList = await AccountManager.getAll();
    if (!accountList || accountList.length === 0) {
      Log.system.console.warn('用户列表为空，不执行锁仓！');
      return;
    }
    /*for (const accoount of accountList) {
      if (accoount.balance === 0) {
        // 自动锁仓
      }
    }*/
  }

  async getLastAveragePrice(symbol: string): Promise<string | undefined> {
    const res = await this.bitbank.getCandlestick(
      symbol, types.CandlestickUnit.Min5, moment.utc().format('YYYYMMDD')).toPromise();
    if (res.candlestick.length > 0) {
      const ohlcv = res.candlestick[0].ohlcv;
      const close1 = ohlcv[ohlcv.length - 3][3];
      const close2 = ohlcv[ohlcv.length - 2][3];
      const close3 = ohlcv[ohlcv.length - 1][3];
      return new BigNumber(close1).plus(close2).plus(close3).div(3).toFixed();
    }
  }

  async getAsset(account: types.Account, position: types.Position): Promise<types.Asset | undefined> {
    const assetType = Util.getTradeAssetType(position.symbol);
    if (position.backtest === '0') {
      const assetsRes = await this.bitbank.getAssets().toPromise();
      const asset = assetsRes.assets.find(o => o.asset === assetType);
      if (!asset) {
        return;
      }
      return <types.Asset>Object.assign({
        account_id: account.id,
        type: position.type,
        backtest: position.backtest
      }, asset);
    } else {
      return account.assets.find(o => o.asset === assetType);
    }
  }

  async postOrder(order: types.Order): Promise<any> {
    // 调用下单API
    const requestOptions = {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        orderInfo: order
      })
    };
    const url = `http://${config.trader.host}:${config.trader.port}/api/v1/order`;
    return await fetch(url, requestOptions);
  }
}
