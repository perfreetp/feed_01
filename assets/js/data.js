/* ============================================================
   清溪县农房确权库 — 示范数据（原型演示用）
   坐标：局部米制平面坐标 (mx,my)，统一投影到经纬度展示
   ============================================================ */
(function () {
  const lat0 = 28.22, lng0 = 116.45;
  const M2LAT = 1 / 111000;
  const M2LNG = 1 / (111000 * Math.cos(28.22 * Math.PI / 180));
  // 米制点 → Leaflet [lat,lng]
  function P(mx, my) { return [lat0 + my * M2LAT, lng0 + mx * M2LNG]; }
  // 中心点矩形 → 经纬度多边形（顺时针）
  function rectPoly(r) {
    const x0 = r.x - r.w / 2, x1 = r.x + r.w / 2, y0 = r.y - r.h / 2, y1 = r.y + r.h / 2;
    return [[y0, x0], [y0, x1], [y1, x1], [y1, x0]].map(c => P(c[1], c[0]));
  }
  function rectOf(x, y, w, h) { return { x, y, w, h }; }
  function areaOf(r) { return Math.round(r.w * r.h); }

  /* ---------------- 材料库 ---------------- */
  const M = {
    zhengshu:  { name: '不动产权证书', sub: '黔（清溪）房地一体 · 证书扫描件 2 页' },
    quanji:    { name: '权籍调查表', sub: '含宗地草图、界址点成果表' },
    qianzhang: { name: '界址签章表 / 四至确认', sub: '本宗及相邻权利人签章' },
    pizhun:    { name: '宅基地使用权审批材料', sub: '农户申请、村组意见、乡镇批准' },
    gongzheng: { name: '继承公证书', sub: '清溪县公证处 · 2026 年' },
    jianding:  { name: '房屋安全鉴定意见', sub: '翻建前现状房屋鉴定 C 级' },
    silin:     { name: '四邻意见书', sub: '北侧相邻户签字确认' },
    chaichu:   { name: '拆除现场核查照片', sub: '自然资源所现场拍摄 4 张' },
    cunzheng:  { name: '村组证明', sub: '村民委员会出具并盖章' },
    fayuan:    { name: '人民法院调解书', sub: '权属分割司法确认' },
  };

  /* ---------------- 房屋工厂 ---------------- */
  function house(parcel, dx, dy, w, h, o) {
    return Object.assign({
      id: 'J' + parcel.code.slice(-5) + '-' + Math.random().toString(36).slice(2, 5),
      rect: rectOf(parcel.rect.x + dx, parcel.rect.y + dy, w, h),
      structure: '砖混', floors: 1, builtYear: 2005,
      area: Math.round(w * h),
    }, o || {});
  }
  function defaultHouse(d) {
    const w = Math.round((d.w - 5) / 2) * 2 + 1, h = Math.round((d.h - 6) / 2) * 2 + 1;
    const floors = d._hf || 2;
    return {
      rect: rectOf(d.x, d.y - 0.5, w, h),
      structure: d._hs || '砖混', floors, builtYear: d._hy || 2012,
      area: Math.round(w * h * floors),
    };
  }

  /* ---------------- 宗地原始定义 ---------------- */
  // rect: 米制中心矩形；status: confirmed 已确权 / changing 办理中 / disputed 争议 / demolished 已拆除
  const defs = [
    // ===== 龙泉镇·龙山村 =====
    { code: 'JC00008', x: -430, y: 330, w: 18, h: 16, town: '龙泉镇', village: '龙山村', group: '二组',
      owner: '王海涛', area: 288, confirmDate: '2020-04-16',
      houses: [ { dx: 0, dy: -1, w: 11, h: 8, structure: '砖混', floors: 2, builtYear: 2009 } ] },
    { code: 'JC00017', x: -455, y: 331, w: 14, h: 13, town: '龙泉镇', village: '龙山村', group: '一组',
      owner: '张陈氏（已故）', area: 182, confirmDate: '2020-04-16',
      houses: [ { dx: 0, dy: 0, w: 9, h: 8, structure: '砖木', floors: 1, builtYear: 1998 } ] },
    { code: 'JC00021', x: -400, y: 350, w: 16, h: 14, town: '龙泉镇', village: '龙山村', group: '三组',
      owner: '李长根', area: 224, confirmDate: '2020-04-17',
      houses: [ { dx: 0, dy: 0.5, w: 11, h: 9, structure: '砖混', floors: 2, builtYear: 2014 } ] },
    { code: 'JC00031', x: -475, y: 352, w: 15, h: 14, town: '龙泉镇', village: '龙山村', group: '一组',
      owner: '赵德明 / 赵德利', area: 210, confirmDate: '2020-04-16', status: 'disputed',
      dispute: '兄弟二人对院坝及附房界址各执一词，2025 年 10 月起争议，原始签章表仅有一人捺印。',
      houses: [ { dx: -1, dy: 1, w: 10, h: 8, structure: '土木', floors: 1, builtYear: 1990 } ] },
    { code: 'JC00042', x: -400, y: 332, w: 16, h: 14, town: '龙泉镇', village: '龙山村', group: '三组',
      owner: '李德福', area: 224, confirmDate: '2020-04-17',
      houses: [ { dx: -1, dy: -2, w: 10, h: 7, structure: '土木', floors: 1, builtYear: 1987 } ] },
    { code: 'JC00049', x: -430, y: 312, w: 15, h: 14, town: '龙泉镇', village: '龙山村', group: '二组',
      owner: '孙桂兰', area: 210, confirmDate: '2020-04-18', _hf: 1, _hy: 2006 },
    { code: 'JC00053', x: -405, y: 311, w: 14, h: 13, town: '龙泉镇', village: '龙山村', group: '二组',
      owner: '周小林', area: 182, confirmDate: '2020-04-18', _hs: '砖木', _hf: 1, _hy: 2003 },
    // ===== 龙泉镇·泉口村 =====
    { code: 'JC00055', x: -540, y: 210, w: 15, h: 14, town: '龙泉镇', village: '泉口村', group: '四组',
      owner: '刘保国', area: 210, confirmDate: '2020-05-09',
      houses: [ { dx: 0, dy: -1, w: 11, h: 8, structure: '砖木', floors: 1, builtYear: 1995 } ] },
    { code: 'JC00060', x: -520, y: 190, w: 16, h: 15, town: '龙泉镇', village: '泉口村', group: '四组',
      owner: '吴春生', area: 240, confirmDate: '2020-05-09',
      houses: [ { dx: 1, dy: 1, w: 13, h: 10, structure: '砖混', floors: 2, builtYear: 2023 } ] },
    { code: 'JC00064', x: -545, y: 168, w: 14, h: 12, town: '龙泉镇', village: '泉口村', group: '三组',
      owner: '黄秋英', area: 168, confirmDate: '2020-05-10', _hf: 1, _hy: 2008 },
    // ===== 白沙镇·白沙村 =====
    { code: 'JC00102', x: 285, y: 105, w: 16, h: 14, town: '白沙镇', village: '白沙村', group: '一组',
      owner: '陈树生', area: 224, confirmDate: '2019-11-22' },
    { code: 'JC00108', x: 307, y: 106, w: 15, h: 14, town: '白沙镇', village: '白沙村', group: '二组',
      owner: '罗水生', area: 210, confirmDate: '2019-11-22',
      houses: [ { dx: 0, dy: -1, w: 10, h: 8, structure: '土木', floors: 1, builtYear: 1992 } ] },
    { code: 'JC00115', x: 286, y: 84, w: 14, h: 13, town: '白沙镇', village: '白沙村', group: '一组',
      owner: '林美凤', area: 182, confirmDate: '2019-11-23', _hf: 1 },
    { code: 'JC00120', x: 308, y: 85, w: 16, h: 14, town: '白沙镇', village: '白沙村', group: '二组',
      owner: '郑有福', area: 224, confirmDate: '2019-11-23' },
    // ===== 白沙镇·樟溪村 =====
    { code: 'JC00201', x: 420, y: 35, w: 16, h: 14, town: '白沙镇', village: '樟溪村', group: '三组',
      owner: '徐老根', area: 224, confirmDate: '2019-12-05' },
    { code: 'JC00207', x: 442, y: 36, w: 14, h: 12, town: '白沙镇', village: '樟溪村', group: '三组',
      owner: '曾小倩', area: 168, confirmDate: '2019-12-05', _hf: 1, _hy: 2010 },
    // ===== 梅岭乡·梅岭村 =====
    { code: 'JC00301', x: -115, y: -345, w: 17, h: 15, town: '梅岭乡', village: '梅岭村', group: '二组',
      owner: '潘大山', area: 255, confirmDate: '2020-08-11' },
    { code: 'JC00308', x: -88, y: -346, w: 15, h: 13, town: '梅岭乡', village: '梅岭村', group: '二组',
      owner: '钟德旺', area: 195, confirmDate: '2020-08-11', _hf: 1 },
    { code: 'JC00312', x: -112, y: -368, w: 14, h: 13, town: '梅岭乡', village: '梅岭村', group: '三组',
      owner: '雷明义', area: 182, confirmDate: '2020-08-12', _hs: '砖木', _hf: 1, _hy: 2004 },
    // ===== 大桥乡·大桥村 =====
    { code: 'JC00401', x: 335, y: -245, w: 16, h: 14, town: '大桥乡', village: '大桥村', group: '一组',
      owner: '高建设', area: 224, confirmDate: '2020-06-20' },
    { code: 'JC00407', x: 358, y: -246, w: 14, h: 13, town: '大桥乡', village: '大桥村', group: '一组',
      owner: '高玉珍', area: 182, confirmDate: '2020-06-20', status: 'disputed',
      dispute: '与西邻高建设共用通道的界线及通行宽度争议，通道内现存附属棚一间，待乡司法所调处。',
      houses: [ { dx: 0, dy: 0, w: 9, h: 8, structure: '砖混', floors: 1, builtYear: 2007 } ] },
    { code: 'JC00412', x: 336, y: -267, w: 15, h: 14, town: '大桥乡', village: '大桥村', group: '二组',
      owner: '宋春牛', area: 210, confirmDate: '2020-06-21', _hf: 1 },
    // ===== 大桥乡·双墩村 =====
    { code: 'JC00501', x: 460, y: -295, w: 15, h: 13, town: '大桥乡', village: '双墩村', group: '四组',
      owner: '段小满', area: 195, confirmDate: '2020-07-02', _hs: '砖木', _hf: 1, _hy: 2006 },
    // ===== 双河乡·河口村 =====
    { code: 'JC00601', x: -360, y: -195, w: 16, h: 14, town: '双河乡', village: '河口村', group: '二组',
      owner: '田来福', area: 224, confirmDate: '2020-03-14' },
    { code: 'JC00608', x: -338, y: -196, w: 14, h: 13, town: '双河乡', village: '河口村', group: '二组',
      owner: '廖三英', area: 182, confirmDate: '2020-03-14', _hf: 1 },
    // ===== 城关镇·东郊村 =====
    { code: 'JC00701', x: 5, y: 385, w: 15, h: 13, town: '城关镇', village: '东郊村', group: '一组',
      owner: '钱守业', area: 195, confirmDate: '2019-10-18' },
    { code: 'JC00708', x: 28, y: 386, w: 15, h: 14, town: '城关镇', village: '东郊村', group: '二组',
      owner: '冯国柱', area: 210, confirmDate: '2019-10-18' },
  ];

  /* ---------------- 宗地对象组装 ---------------- */
  const parcels = defs.map(d => {
    const rect = rectOf(d.x, d.y, d.w, d.h);
    const p = {
      code: d.code, rect, town: d.town, village: d.village, group: d.group,
      owner: d.owner, area: d.area || areaOf(rect),
      use: '农村宅基地（住宅）', rightType: '集体建设用地使用权 / 房屋所有权',
      confirmDate: d.confirmDate, surveyOrg: '清溪县自然资源局权籍调查队',
      status: d.status || 'confirmed',
      dispute: d.dispute || null,
      boundaries: '东至本宗地滴水沟、南至村道、西至相邻宗地界墙、北至村道（以界址点签章表为准）',
      houses: [],
      materials: [M.zhengshu, M.quanji, M.qianzhang, M.pizhun],
      versions: [],
    };
    if (d.houses) {
      p.houses = d.houses.map((h, i) => house(p, h.dx, h.dy, h.w, h.h, {
        structure: h.structure, floors: h.floors, builtYear: h.builtYear, area: Math.round(h.w * h.h * h.floors),
        id: p.code + '-F' + (i + 1), status: 'active',
      }));
    } else {
      p.houses = [Object.assign(defaultHouse(d), { id: p.code + '-F1', status: 'active' })];
    }
    /* 初始版本 V1 */
    p.versions.push({
      ver: 1, date: d.confirmDate, type: '初始确权', source: '农房补充权籍调查（全县第三批）',
      operator: '权籍调查队 · 张勤', note: '统一确权登记发证，界址经村组签章确认。',
      snapshot: { houses: JSON.parse(JSON.stringify(p.houses)) },
      status: 'history',
    });
    return p;
  });

  /* 历史版本：JC00060 吴春生 2023 年翻建（V1→V2，含旧房屋轮廓） */
  (function () {
    const p = byCode('JC00060');
    p.versions[0].snapshot.houses = [{
      id: 'JC00060-F1', status: 'history',
      rect: rectOf(-523, 187, 9, 7), structure: '砖木', floors: 1, builtYear: 1996, area: 63,
    }];
    p.versions.push({
      ver: 2, date: '2023-06-12', type: '翻建', source: '农户申请 + 宅基地翻建批准书',
      operator: '龙泉镇审批办 · 李文娟', note: '拆除原砖木旧房，原址翻建为砖混两层；未超出原宗地界址。',
      snapshot: { houses: JSON.parse(JSON.stringify(p.houses)) }, status: 'current',
    });
    p.materials.push(M.jianding);
  })();

  /* 历史版本：JC00207 曾小倩 2024 年继承（V1→V2，界址不变） */
  (function () {
    const p = byCode('JC00207');
    p.versions[0].snapshot.houses[0].structure = '砖木';
    p.versions[0].snapshot.houses[0].builtYear = 2003;
    p.versions.push({
      ver: 2, date: '2024-11-02', type: '继承', source: '继承公证书（清溪公证 2024-10）',
      operator: '白沙镇审批办 · 陈立', note: '原权利人曾广田去世，房屋及宅基地使用权由其女曾小倩继承；界址、面积不变。',
      snapshot: { houses: JSON.parse(JSON.stringify(p.houses)) }, status: 'current',
    });
    p.materials.push(M.gongzheng);
  })();

  function byCode(code) { return parcels.find(p => p.code === code); }

  /* ---------------- 行政村图斑（底图氛围） ---------------- */
  const villages = [
    { name: '龙山村', x: -437, y: 332, w: 130, h: 108, town: '龙泉镇' },
    { name: '泉口村', x: -532, y: 190, w: 96, h: 86, town: '龙泉镇' },
    { name: '白沙村', x: 297, y: 95, w: 104, h: 92, town: '白沙镇' },
    { name: '樟溪村', x: 431, y: 36, w: 86, h: 66, town: '白沙镇' },
    { name: '梅岭村', x: -101, y: -356, w: 96, h: 80, town: '梅岭乡' },
    { name: '大桥村', x: 347, y: -256, w: 104, h: 88, town: '大桥乡' },
    { name: '双墩村', x: 460, y: -295, w: 70, h: 58, town: '大桥乡' },
    { name: '河口村', x: -349, y: -196, w: 84, h: 66, town: '双河乡' },
    { name: '东郊村', x: 17, y: 386, w: 88, h: 62, town: '城关镇' },
  ].map(v => Object.assign(v, { rect: rectOf(v.x, v.y, v.w, v.h) }));

  /* 道路（米制折线） */
  const roads = [
    { pts: [[-590, 341], [-300, 341]], major: true },                 // 龙山一组村道
    { pts: [[-462, 380], [-462, 285]], major: false },
    { pts: [[-430, 322], [-380, 322]], major: false },
    { pts: [[-580, 178], [-470, 178]], major: false },                // 泉口
    { pts: [[250, 119], [350, 119]], major: true },                   // 白沙
    { pts: [[297, 125], [297, 62]], major: false },
    { pts: [[380, 45], [475, 45]], major: false },                    // 樟溪
    { pts: [[-160, -330], [-50, -330]], major: true },                // 梅岭
    { pts: [[300, -232], [400, -232]], major: true },                 // 大桥
    { pts: [[347, -225], [347, -300]], major: false },
    { pts: [[430, -288], [495, -302]], major: false },                // 双墩
    { pts: [[-400, -180], [-310, -180]], major: true },               // 河口
    { pts: [[-20, 400], [60, 400]], major: false },                   // 东郊
  ].map(r => ({ pts: r.pts.map(c => P(c[0], c[1])), major: r.major }));

  /* 永久基本农田保护图斑 */
  const farmlands = [
    { x: -345, y: 354, w: 80, h: 22, name: '永久基本农田 GQ-0117' },   // 李德福翻建越界处
    { x: -430, y: -250, w: 120, h: 56, name: '永久基本农田 GQ-0203' },
    { x: -40, y: -425, w: 140, h: 64, name: '永久基本农田 GQ-0208' },
    { x: 250, y: 60, w: 90, h: 34, name: '永久基本农田 GQ-0156' },
    { x: 60, y: 350, w: 120, h: 50, name: '永久基本农田 GQ-0099' },
  ].map(f => Object.assign(f, { rect: rectOf(f.x, f.y, f.w, f.h) }));

  /* ---------------- 在办变更申请 ----------------
     scope: { add:[polys-m], adjust:[...], cancel:[...] }  米制多边形点串 */
  const poly = arr => arr.map(c => [c[0], c[1]]); // 已是米制 [mx,my]
  const applications = [
    {
      id: 'A2026-018', parcelCode: 'JC00017', type: '继承', applicant: '张秀兰（之女）',
      submitDate: '2026-08-21', source: '农户申请 + 继承公证书',
      sourceDetail: '原权利人张陈氏于 2026 年 7 月病故，独女张秀兰申请继承房屋所有权及宅基地使用权，家庭成员无异议。',
      docs: [M.gongzheng, M.cunzheng, M.zhengshu],
      scope: null, geometric: false,
      status: '待审核', opinion: '',
    },
    {
      id: 'A2026-019', parcelCode: 'JC00008', type: '分户', applicant: '王海涛 / 王海波',
      submitDate: '2026-08-28', source: '农户申请 + 村组证明',
      sourceDetail: '王海涛与次子王海波分户，原宗地及房屋沿生活院落南北分隔为两宗，分别登记发证；权属分割经家庭协议一致。',
      docs: [M.cunzheng, M.zhengshu, M.quanji],
      scope: {
        adjust: [
          poly([[-438.5, 330.2], [-421.5, 330.2], [-421.5, 337.5], [-438.5, 337.5]]), // 北半宗
          poly([[-438.5, 322.5], [-421.5, 322.5], [-421.5, 329.8], [-438.5, 329.8]]), // 南半宗
        ],
        add: [], cancel: [], labels: ['北半宗 · 王海波', '南半宗 · 王海涛'],
      },
      splitOwners: ['王海波（北）', '王海涛（南）'],
      geometric: true, status: '待审核', opinion: '',
    },
    {
      id: 'A2026-024', parcelCode: 'JC00042', type: '翻建', applicant: '李德福',
      submitDate: '2026-09-02', source: '农户申请 + 宅基地翻建批准文件',
      sourceDetail: '原土木结构住房年久漏雨（鉴定 C 级），申请拆除重建为砖混两层；申请人自行放线，北侧拟建附房及生活间。',
      docs: [M.jianding, M.pizhun, M.quanji],
      scope: {
        add: [
          // 主体（向北越界 4m）
          poly([[-407, 328], [-393, 328], [-393, 343], [-407, 343]]),
          // 东北侧生活间（向东、向北越界，触及基本农田图斑）
          poly([[-392, 339], [-383, 339], [-383, 345], [-392, 345]]),
        ],
        adjust: [], cancel: [[[-406, 326.5], [-396, 326.5], [-396, 333.5], [-406, 333.5]]],
        labels: ['拟建砖混两层', '拟建生活间', '拆除旧房'],
      },
      geometric: true, status: '审核中',
      opinion: '2026-09-05 现场核查：申请人放线位置超出权籍界址，北侧生活间压占基本农田保护图斑约 5 ㎡，与北邻房屋间距不足 3 米。已当场制止施工放线。',
      inspector: '王志强（自然资源所）',
    },
    {
      id: 'A2026-027', parcelCode: 'JC00055', type: '拆除', applicant: '刘保国',
      submitDate: '2026-09-06', source: '农户申请 + 村组证明',
      sourceDetail: '全家已迁入县城居住，自愿拆除地上旧房，注销房屋所有权登记；宅基地使用权按政策保留，不扩大、不翻建。',
      docs: [M.chaichu, M.cunzheng, M.zhengshu],
      scope: { add: [], adjust: [], cancel: [poly([[-545.5, 205], [-534.5, 205], [-534.5, 213], [-545.5, 213]])],
        labels: ['注销房屋轮廓'] },
      geometric: true, status: '待审核', opinion: '',
    },
    {
      id: 'A2026-011', parcelCode: 'JC00108', type: '翻建', applicant: '罗水生',
      submitDate: '2026-07-15', source: '农户申请',
      sourceDetail: '申请原址翻建住房，放线范围在原宗地内；申报材料不齐全，缺少房屋安全鉴定意见及完整四至签章。',
      docs: [M.pizhun, M.quanji],
      missing: [M.jianding, M.qianzhang],
      scope: { add: [poly([[300.5, 102], [313.5, 102], [313.5, 112], [300.5, 112]])], adjust: [], cancel: [],
        labels: ['拟建房屋（宗地内）'] },
      geometric: true, status: '待补正',
      opinion: '2026-07-22 审核：拟建范围未超出界址，但材料不全，退回补正房屋安全鉴定及四邻签章。',
      inspector: '白沙镇审批办 · 陈立',
    },
  ];

  /* ---------------- 乡镇台账（全县口径，已含本年度此前办结量） ---------------- */
  const towns = [
    { id: 'longquan', name: '龙泉镇', center: [-470, 270], closedYTD: 14, disputeExtra: 3 },
    { id: 'baisha',   name: '白沙镇', center: [350, 70],  closedYTD: 9,  disputeExtra: 2 },
    { id: 'meiling',  name: '梅岭乡', center: [-110, -360], closedYTD: 5, disputeExtra: 1 },
    { id: 'daqiao',   name: '大桥乡', center: [400, -270], closedYTD: 7,  disputeExtra: 2 },
    { id: 'shuanghe', name: '双河乡', center: [-350, -205], closedYTD: 3, disputeExtra: 1 },
    { id: 'chengguan',name: '城关镇', center: [20, 390],  closedYTD: 11, disputeExtra: 2 },
  ];

  /* ---------------- 几何工具（米制） ---------------- */
  function bbox(polyPts) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    polyPts.forEach(q => { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); });
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, x0, y0, x1, y1 };
  }
  function rectsOverlap(a, b) {
    return !(a.x + a.w / 2 <= b.x - b.w / 2 || a.x - a.w / 2 >= b.x + b.w / 2 ||
             a.y + a.h / 2 <= b.y - b.h / 2 || a.y - a.h / 2 >= b.y + b.h / 2);
  }
  // Sutherland–Hodgman：多边形被矩形裁剪
  function clipPolyRect(polyPts, r) {
    const rx0 = r.x - r.w / 2, rx1 = r.x + r.w / 2, ry0 = r.y - r.h / 2, ry1 = r.y + r.h / 2;
    let pts = polyPts.slice();
    const clip = (edge) => {
      if (pts.length === 0) return [];
      const out = [];
      const inside = (q) => edge === 'l' ? q[0] >= rx0 : edge === 'r' ? q[0] <= rx1 : edge === 'u' ? q[1] >= ry0 : q[1] <= ry1;
      const inter = (a, b) => {
        let x, y;
        if (edge === 'l' || edge === 'r') { x = edge === 'l' ? rx0 : rx1; const t = (x - a[0]) / (b[0] - a[0]); y = a[1] + t * (b[1] - a[1]); }
        else { y = edge === 'u' ? ry0 : ry1; const t = (y - a[1]) / (b[1] - a[1]); x = a[0] + t * (b[0] - a[0]); }
        return [x, y];
      };
      for (let i = 0; i < pts.length; i++) {
        const cur = pts[i], prev = pts[(i + pts.length - 1) % pts.length];
        const cin = inside(cur), pin = inside(prev);
        if (cin) { if (!pin) out.push(inter(prev, cur)); out.push(cur); }
        else if (pin) out.push(inter(prev, cur));
      }
      pts = out;
    };
    ['l', 'r', 'u', 'd'].forEach(clip);
    return pts;
  }
  function polyArea(polyPts) {
    let s = 0;
    for (let i = 0; i < polyPts.length; i++) {
      const a = polyPts[i], b = polyPts[(i + 1) % polyPts.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s) / 2;
  }

  window.QX = {
    geo: { P, rectPoly, rectOf, bbox, rectsOverlap, clipPolyRect, polyArea,
           M: ([lat, lng]) => [(lng - lng0) / M2LNG, (lat - lat0) / M2LAT] },
    parcels, villages, roads, farmlands, applications, towns, byCode,
    materials: M,
    today: '2026-09-11',
  };
})();
