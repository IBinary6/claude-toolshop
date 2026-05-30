================================================================
.claude-cpp-style 配置说明
================================================================

作用
----
控制 C/C++ 文件保存 / 提交时是否执行代码风格强制流程
（clang-format 格式化、copyright 版权头、cpplint 规范检查、
UTF-8 BOM 补头）。规范基准：Google C++ Style + 现代 C++ 规范。

该文件放在【项目根目录】（与 .git 同级），JSON 格式。
没有该文件时，SessionStart 钩子会检测到 C++ 项目并提示选择模式，
选择后自动生成。建议把该文件加入 .gitignore，不提交到仓库。


字段说明
--------
{
  "mode": "full" | "incremental",
  "baseline": "<git commit hash>",
  "checks": {
    "clangFormat": true,
    "copyright":   true,
    "cpplint":     true,
    "bom":         true
  },
  "copyrightInfo": {
    "company":    "Your Company",
    "author":     "you@example.com",
    "dateFormat": "YYYY/MM/DD HH:mm"
  }
}

mode（必填）
  "full"
      所有 C/C++ 文件都执行三件套（format + copyright + cpplint）。
      适合【新项目】——从一开始就全量强制规范。

  "incremental"
      只有 baseline 之后【新增】的文件执行三件套；
      baseline 时已存在的旧文件不格式化、不加版权、不 lint，
      仅补 BOM（若 checks.bom 为 true）。
      适合【老项目】——存量文件保持原样，避免大面积改动出错，
      只对后续新写的文件强制规范。

baseline（mode 为 incremental 时必填）
  一个 git commit hash，作为"新旧文件"的分界基线。
  判定规则：git cat-file -e <baseline>:<文件相对路径>
      - 命令成功（文件在该 commit 存在）= 旧文件
      - 命令失败（不存在 / 未跟踪）       = 新文件
  通常填启用本配置那一刻的 HEAD（钩子已自动填好，勿手改）。
  mode 为 full 时此字段忽略，可省略。

checks（可选，缺失的字段默认 true）
  四个独立开关，控制各步骤是否执行。设为 false 即关闭该步骤。

  clangFormat   是否用 clang-format 格式化（按 .clang-format 规则，
                  无配置时回退 Google 风格）
  copyright     是否自动添加版权头注释
                  联动：copyright=false，或 copyrightInfo.company 为空时，
                  实际不会写版权头，cpplint 会自动屏蔽 legal/copyright 规则，
                  不会因"缺版权头"误拦截。
  cpplint       是否运行 cpplint 规范检查（违规会拦截保存 / 提交）
  bom           是否补 UTF-8 BOM 头
                  注意：bom 独立于 mode，对【所有文件】生效。
                  即使 incremental 模式下的旧文件，只要 bom=true，
                  没有 BOM 也会补上。

copyrightInfo（可选，各字段可缺省）
  版权头的归属信息。各字段"有什么写什么，没有就不写那一行"：

  company       公司 / 项目归属。**为空或缺失时整个版权头不写**
                  （没有归属的版权头无意义），此时 cpplint 也同步
                  屏蔽 legal/copyright，避免误拦。
  author        作者。为空 / 缺失时不写 Author 行。
  dateFormat    日期格式提示（当前实现固定输出 YYYY/MM/DD HH:mm，
                  此字段为预留/文档用途）。

  生成的版权头形如：
      // Copyright 2026 Your Company. All rights reserved.
      // Author you@example.com
      // Date 2026/05/30 14:08
      // foo.cc


模板继承机制（重点）
--------------------
版权信息无需逐项目重填。存在一个【用户级模板】：

      ~/.claude/cpp-style-template.json

  - 插件首次 SessionStart 时，若该文件不存在，会从插件出厂默认
    模板（templates/cpp-style-template.default.json）复制一份过去。
  - 新项目首次被检测时，SessionStart 提示 Claude 写入的
    .claude-cpp-style 内容（checks + copyrightInfo）即**继承自该
    用户模板**，只在其上覆盖 mode 与 baseline。
  - 因此：你只需把公司名 / 作者填进 ~/.claude/cpp-style-template.json
    一次，之后所有新项目都自动带上，无需每个项目重复配置。
  - 项目级 .claude-cpp-style 里的 copyrightInfo 优先级高于用户模板；
    项目没写 copyrightInfo 时回退用户模板。

出厂默认模板内容（company / author 留空 = 默认不写版权行）：
{
  "checks": { "clangFormat": true, "copyright": true, "cpplint": true, "bom": true },
  "copyrightInfo": { "company": "", "author": "", "dateFormat": "YYYY/MM/DD HH:mm" }
}


配置示例
--------
1) 新项目，全套强制（含版权头）：
{
  "mode": "full",
  "checks": { "clangFormat": true, "copyright": true, "cpplint": true, "bom": true },
  "copyrightInfo": { "company": "Acme Inc.", "author": "dev@acme.com" }
}

2) 老项目，仅新文件强制，旧文件只补 BOM：
{
  "mode": "incremental",
  "baseline": "5ec493503b7a04abbbdbf3d52e389ae02d2123da",
  "checks": { "clangFormat": true, "copyright": true, "cpplint": true, "bom": true },
  "copyrightInfo": { "company": "Acme Inc." }
}

3) 想要 cpplint + 格式化但不要版权头（company 留空即可，无需关 copyright）：
{
  "mode": "full",
  "checks": { "clangFormat": true, "copyright": true, "cpplint": true, "bom": true },
  "copyrightInfo": { "company": "" }
}

4) 只想统一编码（全项目补 BOM），完全不做格式化 / lint：
{
  "mode": "incremental",
  "baseline": "<hash>",
  "checks": { "clangFormat": false, "copyright": false, "cpplint": false, "bom": true }
}


行为速查表
----------
                        mode=full   mode=incremental
                        所有文件     新文件   旧文件
  clangFormat 格式化      ✓          ✓        ✗
  copyright   版权头      ✓          ✓        ✗
  cpplint     规范检查    ✓          ✓        ✗
  bom         BOM 补头    ✓          ✓        ✓     ← 受 checks.bom 控制，独立于 mode
（上表前提是对应 checks 开关为 true；设为 false 则该列全部不执行）
（copyright 列还额外要求 copyrightInfo.company 非空，否则不写头）


常见问题
--------
Q: 删了 .claude-cpp-style 会怎样？
A: 下次 SessionStart 会重新检测、重新提示选择模式。

Q: JSON 写错了 / 格式损坏？
A: 当作"未配置"处理，所有三件套都不执行（保守，不打断），
   并在下次 SessionStart 重新提示。

Q: 改了 baseline 想重新划定新旧分界？
A: 把 baseline 换成新的 commit hash 即可，立即生效，无需重启。

Q: 旧文件被我改动了，会被格式化吗？
A: 不会。incremental 模式下旧文件永远只补 BOM，不格式化 /
   不加版权 / 不 lint。只有 baseline 之后新建的文件才走三件套。

Q: 想给所有新项目统一公司名怎么办？
A: 编辑 ~/.claude/cpp-style-template.json 的 copyrightInfo 一次即可，
   之后新项目自动继承。
================================================================
