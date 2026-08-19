# bin-lian.me 重构总纲

> 本文件是主页重构的唯一总纲。所有设计决策、物理规格、待办都以此为准，随进展更新。

## 定位

「科学家 × 建造者」：UT Austin 材料学博士（nano self-assembly / micromotor swarms / Raman nanosensors，Sci. Adv. + Nat. Commun.）+ WETO Robotics CTO（sEMG × AI）。风格 = deep-tech CTO，不是学术模板页，也不是程序员黑客风。

参考基准：版式骨架 brittanychiang.com (v4)，hero 手感 Codrops Interactive Particles 但物理为真，光感 linear.app/lusion.co 的克制版，微交互 rauno.me。

## 已确认决策

- **视觉**：深色 deep-tech。深蓝近黑底 + 青色强调。⚠️ **当前配色是临时的，上线前必须做一轮配色精修**（Bin: 现在有点丑）
- **架构**：零构建零依赖。`index.html / style.css / particles.js / data.js` 四文件，GitHub Pages 直接托管
- **hero = 真物理**：Langevin 动力学，组装从势阱涌现（绝不 tween），组装后热涨落永不停止
- **物理面板（左下角）**：Langevin 方程 + V(r,t) 分解式 + **实时势能面，45° 倾斜 3D 高度场**（深度可见）；鼠标力 = 光标高斯势的解析 −∇V，面板与模拟严格同一个 V
- **交互彩蛋（全要）**：鼠标局域场源、点击脉冲熔化-再结晶、字形循环 TEXT→六角晶格→WIRES（场致偶极链化）、kT 滑块、闭环微操控小游戏（放微马达研究卡，v1 反馈控制器诚实标注，v2 离线训练 RL 策略权重内嵌）
- **WETO 露出**：轻露出三处——hero 身份行、一张 Industry 卡、timeline 并行轨道。不做公司页
- **工作方式**：subagent（opus/sonnet）写代码，主会话只写 spec 和 review

## 物理引擎规格（particles.js）

- `CONFIG` 顶部集中所有旋钮：`N, kT, kTScale, gamma, kTrap, repelR/E, mouseR/A, pesVref, meltTime, pulseKT, word, …`
- Langevin：`dv = (−γv + F)dt + √(2γkT·dt)·η`，semi-implicit Euler，固定 dt + 累加器
- 短程软排斥：空间哈希 O(N)；渲染：预渲染发光 sprite + 'lighter' 合成 + 拖尾；DPR 自适应
- 字形目标：离屏 fillText → 像素采样 → 贪心分配；换字 = 改 `CONFIG.word`
- 模式机：`GAS → TEXT ⇄ MELT`，后续加 `LATTICE / WIRES`
- 熔化 = 激光脉冲加热（kT ×pulseKT 指数冷却）+ 关阱 meltTime 秒
- 约 12% 粒子留作背景气体；5% 琥珀示踪粒子
- `prefers-reduced-motion`：静态组装帧

## 页面章节（内容全在 data.js）

1. **Hero** — 粒子组装名字；`PhD Researcher @ UT Austin · CTO @ WETO Robotics`；tagline "I study how matter organizes itself — and build tools that command it."；CV → `image/file/Bin_s_Resume.pdf`（路径不可动，外部有链接）
2. **Selected Work** — 4 卡：Raman Nanosensors / Microbubble Nano-Assembly (Nat. Commun.) / Micromotor Swarm Control (Sci. Adv.，内嵌控制小游戏) / WETO sEMG×AI（标 Industry）
3. **Publications** — 期刊徽章 + 作者行（Bin Lian 加粗、共一 †）
4. **Journey** — 双轨 timeline：学术 USTC → Berkeley → Brown → UT Austin ∥ industry NSF I-Corps → WETO CTO
5. **Toolbox** — Compute / Simulate / Fabricate 三栏
6. **Awards + Teaching** — 紧凑条状，保留 `image/file/TA/*` 笔记链接
7. **Footer** — email / GitHub / LinkedIn / blog.bin-lian.com

## 工作流与状态

- 仓库本地：`/Users/lianbin/workdir/_codes_/New_Project/website/My_home_page`，开发在 `redesign` 分支，Bin 批准后合 `main` 自动部署
- 本地预览：`python3 -m http.server 8137 --directory <repo>`
- [x] Step 0 原型 `hero-prototype.html`：Langevin 引擎 + 名字组装 + 鼠标 −∇V + 点击熔化 + kT 滑块 + 物理面板（方程 + 势能面）
- [x] 势能面板升级 3D 倾斜高度场（ridgeline，旋钮 `pesTilt/pesHeight/pesShear`）
- [ ] 手感定稿（Bin 签字）
- [ ] 整站搭建（index/style/particles/data 四文件）
- [ ] LATTICE / WIRES 模式 + 控制小游戏
- [ ] **配色精修专项**（上线前必做）
- [ ] 移动端 + reduced-motion + 性能验收
- [ ] 合并 main 上线，旧 Bootstrap 文件清理
