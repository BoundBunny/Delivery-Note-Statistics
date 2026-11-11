"""磁盘卫生：不乱下载、不乱写、导出/分享都落在受控目录。

覆盖：
- saveFile 只写入测试目录，仓库 CommercesData 不被污染
- shareFile 反复分享同名文件只覆盖、不堆叠
- 选择商品图片只复制到指定图片目录，无临时残留
- Excel 导出走 saveFile 桥，落在保存目录且非空
- 全程无任何 http/https 网络请求（离线）
"""
import pathlib


def _files(d: pathlib.Path) -> set[str]:
    d = pathlib.Path(d)
    if not d.exists():
        return set()
    return {str(p.relative_to(d)) for p in d.rglob("*") if p.is_file()}


def test_save_file_writes_only_to_test_dir(app):
    before = _files(app.save_dir)
    before_repo = _files(app.repo / "CommercesData")
    res = app.eval(
        """async () => {
            const b64 = btoa('hello delivery-note');
            return await window.Android.saveFile('report.txt', 'text/plain', b64);
        }"""
    )
    assert res["ok"] is True, res
    target = pathlib.Path(res["path"])
    app.assert_under(str(target), app.save_dir)
    assert target.read_text(encoding="utf-8") == "hello delivery-note"
    after = _files(app.save_dir)
    assert after - before == {"report.txt"}, f"unexpected extra files: {after - before}"
    assert _files(app.repo / "CommercesData") == before_repo, "repo CommercesData was polluted"


def test_share_file_repeated_does_not_pile_up(app):
    before = _files(app.save_dir)
    for i in range(3):
        res = app.eval(
            """async (i) => {
                const b64 = btoa('share-' + i);
                return await window.Android.shareFile('share.txt', 'text/plain', b64);
            }""",
            i,
        )
        assert res["ok"] is True, res
        app.assert_under(str(res["path"]), app.save_dir)
    target = pathlib.Path(res["path"])
    assert target.read_text(encoding="utf-8") == "share-2"
    after = _files(app.save_dir)
    assert after - before == {"share.txt"}, f"share piled up files: {after - before}"
    # 不应再创建旧的“下载/送货单统计”子目录
    assert not (app.save_dir / "送货单统计").exists()


def test_product_image_copied_into_configured_dir(app):
    before = _files(app.image_dir)
    before_repo = _files(app.repo / "CommercesData")
    res1 = app.eval(
        "async (dir) => await window.Android.pickProductImage(dir)", str(app.image_dir)
    )
    assert res1["ok"] is True, res1
    p1 = pathlib.Path(res1["path"])
    assert p1.parent.resolve() == app.image_dir.resolve()
    assert p1.exists() and p1.stat().st_size > 0
    res2 = app.eval(
        "async (dir) => await window.Android.pickProductImage(dir)", str(app.image_dir)
    )
    p2 = pathlib.Path(res2["path"])
    assert p2 != p1 and p2.exists()
    after = _files(app.image_dir)
    assert len(after - before) == 2, f"unexpected image leftovers: {after - before}"
    assert not list(app.image_dir.glob("*.tmp")), "temporary files left behind"
    assert _files(app.repo / "CommercesData") == before_repo, "repo CommercesData was polluted"


def test_excel_export_goes_to_save_dir(app):
    before = _files(app.save_dir)
    res = app.eval(
        """async () => {
            const bytes = Xlsx.build([{ name: 't', title: 't', headers: ['a'], rows: [[1]] }]);
            const blob = xlsxBlob(bytes);
            return await downloadBlob('导出测试.xlsx', blob);
        }"""
    )
    assert res["ok"] is True, res
    target = pathlib.Path(res["path"])
    app.assert_under(str(target), app.save_dir)
    assert target.exists() and target.stat().st_size > 0
    after = _files(app.save_dir)
    assert after - before == {"导出测试.xlsx"}, f"unexpected files: {after - before}"


def test_no_network_requests_at_all(app):
    app.requests.clear()
    app.eval(
        """async () => {
            Store.addOrder({
                no: Store.nextOrderNo('2026-11-14'), date: '2026-11-14', customer: null,
                items: [{ name: '离线商品', qty: 1, price: 1, amount: 1 }], total: 1
            });
            await DNSDesktop.navigate('#/stats');
            await new Promise(r => setTimeout(r, 100));
            await DNSDesktop.navigate('#/products');
            await new Promise(r => setTimeout(r, 100));
            return true;
        }"""
    )
    assert app.page_errors == [], app.page_errors
    offenders = app.http_requests()
    assert offenders == [], f"unexpected network calls: {offenders}"
    resources = app.eval(
        "() => performance.getEntriesByType('resource').map(e => e.name).filter(n => /^https?:/.test(n))"
    )
    assert resources == [], f"unexpected resource fetches: {resources}"
