'use strict';

// Persist before sending: a lost response or a page restart must reuse the key.
// The completed phase makes cart updates replayable if storage fails mid-write.
function read(scope) { return wx.getStorageSync(scope) || null; }
function write(scope, value) { wx.setStorageSync(scope, value); }
function clear(scope) { write(scope, null); }
async function submit(scope, call, cart) {
  let pending = read(scope);
  if (!pending) throw Error('没有待确认的订单');
  if (!pending.completed) {
    let order;
    try { order = await call('createOrder', pending.input); }
    catch (error) {
      // Only a definite business rejection permits a new submission key.
      if (error.definitive === true) clear(scope);
      throw error;
    }
    const remaining = cart.map(line => ({ ...line, qty: line.qty - pending.input.lines
      .filter(item => item.productId === line.productId && item.skuId === line.skuId)
      .reduce((sum, item) => sum + item.qty, 0) })).filter(line => line.qty > 0);
    pending = { ...pending, completed: { order, cart: remaining } };
    write(scope, pending);
  }
  wx.setStorageSync('pet-cart', pending.completed.cart);
  clear(scope);
  return pending.completed;
}
module.exports = { read, write, clear, submit };
