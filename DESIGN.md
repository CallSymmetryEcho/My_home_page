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

## 已确认决策

- 深色 deep-tech；⚠️ 配色是临时占位，上线前必须专项精修（Bin：现在有点丑）
- **Three.js 本地 vendor**（`js/vendor/`，three 0.185.1 + postprocessing/RoomEnvironment，importmap，零构建、无 CDN）；物理引擎仍是自研 Langevin，Three.js 只做渲染
- **势能面融入 3D 场景**：粒子群脚下的发光线框地形 = V(x,y)，名字是雕进地形的峡谷，鼠标推起山丘、粒子同步散开且被地形抬起；Langevin 方程保留为屏幕叠加层
- **粒子 = 晶莹剔透玻璃球**：InstancedMesh + MeshPhysicalMaterial(transmission) + RoomEnvironment 反射 + UnrealBloom
- canvas 2D 引擎（hero-prototype.html）保留为移动端/低性能/无 WebGL 降级
- 手感修正 v2：mouseR 80→45（势太宽）、pesVref 5e4→2.5e4 + terrainRelief（势阱太浅没对比度）、玻璃+bloom+3D（冲击力）
- subagent（opus/sonnet）写代码，主会话只写 spec 和 review
- **一个章节一个章节落实**，每节 Bin 验收后进下一节

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
- [ ] **① Hero 3D 原型**（进行中：physics.js 提炼 + scene3d.js + hero3d-prototype.html）→ Bin 验收手感/帧率
- [ ] ② Fields of Control
- [ ] ③ Closing the Loop（+小游戏后置）
- [ ] ④ Journey ⑤ Toolbox ⑥ Awards+Teaching+Footer（可合并）
- [ ] ⑦ 收尾：LATTICE/WIRES 模式循环、配色精修（必做）、移动端/性能/a11y
- [ ] 合并 main 上线，旧 Bootstrap 清理
