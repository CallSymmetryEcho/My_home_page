# bin-lian.me 重构总纲 v2

> 唯一总纲。所有设计决策、物理规格、待办以此为准，随进展更新。

## 定位与叙事（v2 修正）

主线：**纳米尺度的控制策略——用不同物理场指挥物质，并自建硬件与 AI 闭环**。

- 四个物理场 = 四条研究线：**光电场**（Optoelectric Raman 一作 preprint：−0.8V 150× 增强、0.6 fM adenine；Optically-induced nano-patterning 2026）、**热场**（PS 温控组装：双电层机制，Clark-Evans R 1.10→1.65、ψ₆↑，LAMMPS 分段 MD + S4 布朗动力学闭环，ongoing）、**电场**（micromotor swarms Sci. Adv. 2023 31 引；microbubble nano-assembly Nat. Commun. 2025）、**溶剂化**（phase separation 凝胶 ChemRxiv preprint）
- Builder 层（Closing the Loop）：AlchemArm AI 化学家机械臂（LLM+CV+DL/RL 闭环、自建 18.18:1 减速、±0.02mm、自动 MACE/HF）、自制 PCB 电场控制硬件、RL/PINN 反向优化 PID（exploratory）、ML surrogate for FEM（6h→7ms）、CNN-LSTM 手套数字孪生（4 传感器解耦 5 指 98%）
- **诚实标注**：published 仅 Sci. Adv. 2023 与 Nat. Commun. 2025；Raman/凝胶是 preprint；2026 nano-patterning 期刊未定
- **克制不炫耀**（Bin 总原则）：不做 Publications 陈列章节，完整清单交给 Download CV；成果用事实和物理讲话
- **WETO/Orchesta 毕业后再加**（参考 wetourrobotics.com）：data.js 预留 `enabled:false` 条目；hero 身份行本期只写 PhD 侧

参考基准：骨架 brittanychiang.com (v4)、光感 linear.app/lusion.co 克制版、打磨 rauno.me。

## 已确认决策（v3 视觉语言，2026-08 定稿方向）

- **GR 时空织物美学**：纯黑深空底（#000004）+ 稀疏星尘；势能面 = 细白线四边形网格（LineSegments，无三角对角线），**线的弯曲即势能高低**——借鉴广义相对论橡胶膜可视化；整体单色白 + 一个极克制强调色。质感基准 lusion.co
- **单一倾斜时空织物（v3.1 修正，Bin 否决双层构图）**：粒子直接躺在势能面上，整面向相机倾斜 ~45°（GR 演示台角度）——粒子重组与织物形变在屏幕同一处重叠；**每颗珠子在织物上压出自己的高斯小凹陷**（布朗气体 = 一片游走的酒窝，光标的含义自然可读）；**同步涌现动画**：场强 λ(t) 从 0 缓升——先看到平整织物上浮现字形势阱，再看到珠子滚进去组装（λ 同时缩放阱深与受力，因果顺序可见）
- **光标 = 光镊（吸引阱）**：mouseA 取负，织物凹陷、粒子聚拢跟随——对应 optoelectric enrichment；公式随之带负号保持严格一致
- **Three.js 本地 vendor**（0.185.1 拆分构建含 three.core.js），零构建；物理仍是自研 Langevin
- **单画布滚动叙事**：一个常驻 WebGL canvas，HTML 卡片滚动叠加；平滑虚拟滚动（Lusion 开源 WebGL-Scroll-Sync 思路）驱动相机/编队/织物；**章节转场 = 换目标点集 + Langevin 自由飞行**（物理即转场）
- **粒子是贯穿全站的线索**，分镜：Hero 名字 → Light 聚焦光锥 → Heat 六角晶格 → Electric 链化线阵 → Solvation 凝胶网络 → Machines PCB 走线闭环 → Journey 深空星座（USTC→Berkeley→Brown→UT Austin）→ 尾声星尘 + CV
- **「From Physics to Machines」章节**承载技能线（Physics-AI 创始人叙事桥）：PCB 走线编队 + 工程规格书美学卡片（I design the electronics / build the machines / write the policies / close the loop），结尾一句 "Toward physical AI — machines that learn to command matter."；原 Toolbox 并入
- 顶部导航：1px 发丝线 + 字距拉宽 wordmark + mono 链接；左下角 Langevin 公式保留（白色）
- canvas 2D 引擎保留为降级；subagent 写码我 review；**每个视觉里程碑必须先自己截图审查再交付**（Bin 明确要求）
- 逐章节落实，每节 Bin 验收后进下一节

## 站点章节

1. **Hero（Three.js）**：玻璃粒子在势能地形上自组装 "BIN LIAN"；kT 滑块=thermal field、光标=field source、点击=laser pulse；模式循环 TEXT→六角晶格（热场）→线阵列（电场链化）
2. **Fields of Control**：Light / Heat / Electric / Solvation 四张场卡（关联论文行 + preprint 状态标注）
3. **Closing the Loop**：AlchemArm、PCB 硬件、RL/PINN、ML surrogate、手套数字孪生；微操控小游戏后置迭代
4. ~~Publications~~ 不做独立章节，CV 链接（`image/file/Bin_s_Resume.pdf`，路径不可动）
5. **Journey**：学术单轨 USTC → Berkeley → Brown → UT Austin（industry 轨道随 WETO 毕业后启用）
6. **Toolbox**：Compute / Simulate / Fabricate
7. **Awards + Teaching**（保留 `image/file/TA/*`）、**Footer**（email/GitHub/LinkedIn/blog）

## 文件布局

```
index.html            importmap + 章节（整站阶段）
style.css             token 全在 :root
js/vendor/            three.module.js + jsm/{postprocessing,shaders,environments}
js/physics.js         Langevin 核心（渲染无关；CONFIG 全旋钮；fillPotential 供地形）
js/scene3d.js         Three.js 层（玻璃球/地形/bloom/raycast 指针/视差）
js/hero2d.js          2D 降级（整站阶段从 hero-prototype.html 搬运）
js/data.js            全部内容数据（WETO enabled:false）
hero-prototype.html   2D 参照/试验台（保留）
hero3d-prototype.html Step1 交付物
```

## 待办（章节制）

- [x] Step 0：2D 原型（Langevin + 鼠标 −∇V + 熔化 + kT + 方程/2D→3D 势能面板）
- [x] three.js vendor 落库
- [x] **① Hero 3D 原型**：单一 55° 倾斜 GR 织物 + 珠子贴面 + 每珠酒窝 + λ 涌现动画 + 光镊（Bin 认可基础效果）
- [x] ①b 光标激光束特效（落点辉光骑在阱底、点击脉冲爆闪与熔化共用 pulse 变量）——**Hero 章节暂收口**
- [ ] ①c 镜头视角/远近的沉浸式调优（后续打磨项，Bin 提出）
- 流程注记：`node --check` 对带 ESM import 的 .js 会漏报语法错误——JS 验证必须实际加载页面（或 --input-type=module）
- [ ] ② Fields of Control
- [ ] ③ Closing the Loop（+小游戏后置）
- [ ] ④ Journey ⑤ Toolbox ⑥ Awards+Teaching+Footer（可合并）
- [ ] ⑦ 收尾：LATTICE/WIRES 模式循环、配色精修（必做）、移动端/性能/a11y
- [ ] 合并 main 上线，旧 Bootstrap 清理
