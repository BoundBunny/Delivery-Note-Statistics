"""数据完整性：数据不流失、不重复、不脏写。

覆盖：
- 启动冒烟（桥接/数据层/工作台就绪，无未捕获异常）
- 初始商品种子幂等（重启不会重复写入）
- 客户/商品/单据/一客一价 在重启后完整保留
- 保存后被强杀（模拟崩溃）仍能恢复，且不产生重复单据
- 事务中途抛错整体回滚
- localStorage 写入失败（模拟配额耗尽）时内存与磁盘都不留半成品
- 备份导出/恢复往返一致
- 单实例锁：同 profile 不允许多开（避免双写坏数据）
"""
import time


def test_boot_smoke(app):
    assert "送货宝" in app.page.title()
    info = app.eval(
        """() => ({
            hasAndroid: !!(window.Android && window.Android.saveFile && window.Android.shareFile),
            hasStore: typeof Store === 'object' || typeof Store === 'function',
            ready: !!(window.DNSDesktop && window.DNSDesktop.ready),
            nav: document.querySelectorAll('#desktop-app .nav-item').length,
            metrics: document.querySelectorAll('#desktop-app .metric').length
        })"""
    )
    assert info["hasAndroid"] is True
    assert info["hasStore"] is True
    assert info["ready"] is True
    assert info["nav"] >= 5
    assert info["metrics"] >= 1
    assert app.page_errors == [], f"uncaught page errors: {app.page_errors}"


def test_seed_products_are_idempotent_across_restart(app):
    first = app.eval(
        """() => ({
            count: Store.countAll().products,
            flag: localStorage.getItem('sd_v1_seed_products_v4')
        })"""
    )
    assert first["flag"] == "1"
    app.restart()
    second = app.eval(
        """() => ({
            count: Store.countAll().products,
            flag: localStorage.getItem('sd_v1_seed_products_v4')
        })"""
    )
    assert second["flag"] == "1"
    assert second["count"] == first["count"], "seed products were duplicated on restart"


def test_crud_persists_across_restart(app):
    created = app.eval(
        """() => {
            const c = Store.upsertCustomer({ name: '持久客户A', phone: '13800000000', address: '广州' });
            const p = Store.upsertProduct({ name: '持久商品X', spec: '500ml', unit: '瓶', price: 3.5, category: 'drink' });
            const o = Store.addOrder({
                no: Store.nextOrderNo('2026-11-10'), date: '2026-11-10',
                customer: c,
                items: [{ pid: p.id, name: p.name, spec: p.spec, unit: p.unit, qty: 2, price: 3.5, amount: 7 }],
                total: 7
            });
            Store.setLastPrice(c.id, p.id, 3.2);
            return { cId: c.id, pId: p.id, oId: o.id, no: o.no, counts: Store.countAll() };
        }"""
    )
    assert created["counts"]["orders"] == 1
    app.restart()
    after = app.eval(
        """(ids) => {
            const order = Store.getOrder(ids.oId);
            return {
                customer: (Store.getCustomer(ids.cId) || {}).name || null,
                product: (Store.getProduct(ids.pId) || {}).name || null,
                order: order ? { no: order.no, total: order.total, qty: order.items[0].qty, cust: order.customer && order.customer.name } : null,
                lastPrice: Store.getLastPrice(ids.cId, ids.pId),
                counts: Store.countAll()
            };
        }""",
        created,
    )
    assert after["customer"] == "持久客户A"
    assert after["product"] == "持久商品X"
    assert after["order"] is not None
    assert after["order"]["no"] == created["no"]
    assert after["order"]["total"] == 7
    assert after["order"]["qty"] == 2
    assert after["order"]["cust"] == "持久客户A"
    assert after["lastPrice"] == 3.2
    assert after["counts"]["orders"] == 1


def test_data_survives_hard_kill_without_duplication(app):
    info = app.eval(
        """() => {
            const o = Store.addOrder({
                no: Store.nextOrderNo('2026-11-11'), date: '2026-11-11',
                customer: null,
                items: [{ name: '强杀商品', qty: 5, price: 2, amount: 10 }],
                total: 10
            });
            return { oId: o.id, no: o.no, orders: Store.countAll().orders };
        }"""
    )
    # 模拟崩溃：Chromium 的 localStorage 约每 5s 才批量落盘一次，先等它刷盘再硬杀。
    app.settle(6.5)
    app.hard_kill()
    app.start()
    after = app.eval(
        """(info) => ({
            order: Store.getOrder(info.oId) ? true : false,
            totals: Store.listOrders().map(o => o.total),
            orders: Store.countAll().orders,
            sameNoCount: Store.listOrders().filter(o => o.no === info.no).length
        })""",
        info,
    )
    assert after["order"] is True, "saved order was lost after a hard kill"
    assert after["orders"] == info["orders"]
    assert after["sameNoCount"] == 1, "duplicate order number after restart"


def test_transaction_rolls_back_on_exception(app):
    res = app.eval(
        """() => {
            const before = Store.countAll();
            let err = null;
            try {
                Store.transaction(() => {
                    Store.upsertProduct({ name: 'TX-应当回滚', price: 1 });
                    throw new Error('boom');
                });
            } catch (e) { err = String(e && e.message || e); }
            return {
                before, after: Store.countAll(), err,
                found: Store.listProducts().some(p => p.name === 'TX-应当回滚')
            };
        }"""
    )
    assert res["err"] and "boom" in res["err"]
    assert res["found"] is False
    assert res["after"]["products"] == res["before"]["products"]


def test_persist_failure_leaves_no_partial_write(app):
    res = app.eval(
        """() => {
            const before = Store.countAll().orders;
            const orig = Storage.prototype.setItem;
            let threw = null, code = null;
            Storage.prototype.setItem = function (k, v) {
                if (k === 'sd_v1_orders') throw new Error('QuotaExceededError');
                return orig.call(this, k, v);
            };
            try {
                Store.addOrder({
                    no: 'FAIL-' + Date.now(), date: '2026-11-12', customer: null,
                    items: [{ name: '写失败商品', qty: 1, price: 1, amount: 1 }], total: 1
                });
            } catch (e) { threw = String(e && e.message || e); code = e && e.code || null; }
            finally { Storage.prototype.setItem = orig; }
            const persisted = JSON.parse(localStorage.getItem('sd_v1_orders') || '[]');
            return {
                before, after: Store.countAll().orders, threw, code,
                persistedCount: persisted.length,
                found: Store.listOrders().some(o => String(o.no).startsWith('FAIL-'))
            };
        }"""
    )
    assert res["threw"] is not None
    assert res["code"] == "SD_STORAGE_WRITE_FAILED"
    assert res["after"] == res["before"], "in-memory orders were not rolled back"
    assert res["persistedCount"] == res["before"], "partial write leaked into localStorage"
    assert res["found"] is False


def test_backup_export_import_roundtrip(app):
    res = app.eval(
        """() => {
            const c = Store.upsertCustomer({ name: '备份客户' });
            const p = Store.upsertProduct({ name: '备份商品', spec: '1L', price: 2 });
            Store.addOrder({
                no: Store.nextOrderNo('2026-11-13'), date: '2026-11-13', customer: c,
                items: [{ name: '备份商品', spec: '1L', qty: 3, price: 2, amount: 6 }], total: 6
            });
            const snapshot = Store.countAll();
            const backup = Store.exportJSON();
            Store.clearAll();
            const cleared = Store.countAll();
            Store.importJSON(backup);
            return {
                snapshot, cleared, restored: Store.countAll(),
                hasCustomer: Store.listCustomers().some(x => x.name === '备份客户'),
                hasOrder: Store.listOrders().some(x => x.total === 6)
            };
        }"""
    )
    assert res["restored"] == res["snapshot"], "restore did not reproduce the snapshot"
    assert res["cleared"]["orders"] == 0
    assert res["hasCustomer"] is True
    assert res["hasOrder"] is True


def test_single_instance_guard(app):
    second = app.spawn_second_instance()
    try:
        rc = second.wait(timeout=20)
    finally:
        if second.poll() is None:
            second.kill()
    assert rc == 0, "a second instance sharing the profile did not exit"
    # 原实例仍然可用
    assert app.eval("() => typeof Store === 'object' || typeof Store === 'function'")
