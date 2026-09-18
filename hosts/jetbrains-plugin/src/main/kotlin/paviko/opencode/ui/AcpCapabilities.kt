package paviko.opencode.ui

import com.intellij.openapi.project.Project

/**
 * ACP capability manifest reported by the JetBrains host.
 *
 * Contracts are designed around the IntelliJ platform model (see change
 * `idea-acp-capabilities`); they intentionally do not mirror VS Code tool ids.
 */
internal fun defaultAcpCapabilities(@Suppress("UNUSED_PARAMETER") project: Project): Map<String, Any?> {
    val categories = listOf(
        intellijCategory(),
        tasksAndProblemsCategory(),
        terminalCategory(),
        debugCategory(),
    )
    return mapOf("categories" to categories)
}

private fun intellijCategory(): Map<String, Any?> = mapOf(
    "id" to "intellij",
    "name" to "IntelliJ IDEA",
    "description" to "运行内置 Action 与代码编辑",
    "status" to "connected",
    "tools" to listOf(
        mapOf(
            "id" to "executeAction",
            "name" to "运行内置 Action",
            "description" to "在 IntelliJ IDEA 中执行已注册的 Action（如 ReformatCode, SaveAll 等）",
            "parametersSchema" to mapOf(
                "type" to "object",
                "properties" to mapOf(
                    "actionId" to mapOf("type" to "string", "description" to "Action 标识符，如 ReformatCode, SaveAll, RenameElement")
                ),
                "required" to listOf("actionId")
            )
        ),
        mapOf(
            "id" to "listActions",
            "name" to "列出可用 Action",
            "description" to "检索或根据前缀过滤 IntelliJ 中可用的 Action 列表",
            "parametersSchema" to mapOf(
                "type" to "object",
                "properties" to mapOf(
                    "prefix" to mapOf("type" to "string", "description" to "可选的 Action ID 前缀或关键字")
                )
            )
        ),
        mapOf(
            "id" to "editor",
            "name" to "打开与查看文件",
            "description" to "在编辑器中打开指定文件并跳转到目标行",
            "parametersSchema" to mapOf(
                "type" to "object",
                "properties" to mapOf(
                    "path" to mapOf("type" to "string", "description" to "目标文件的相对或绝对路径"),
                    "line" to mapOf("type" to "integer", "description" to "可选跳转行号（从 1 开始）")
                ),
                "required" to listOf("path")
            )
        )
    )
)

private fun tasksAndProblemsCategory(): Map<String, Any?> = mapOf(
    "id" to "tasks_and_problems",
    "name" to "任务与运行配置",
    "description" to "检索与执行运行/调试配置，检查代码问题",
    "status" to "connected",
    "tools" to listOf(
        mapOf(
            "id" to "listRunConfigurations",
            "name" to "列出运行配置",
            "description" to "检索当前工程中已配置的所有 Run/Debug Configuration",
            "parametersSchema" to mapOf(
                "type" to "object",
                "properties" to emptyMap<String, Any>()
            )
        ),
        mapOf(
            "id" to "getProblems",
            "name" to "检查代码问题",
            "description" to "对当前活动文件（或指定文件/目录）运行 inspections 并返回问题列表（文件、行列、严重级别、描述）",
            "parametersSchema" to mapOf(
                "type" to "object",
                "properties" to mapOf(
                    "path" to mapOf("type" to "string", "description" to "可选文件或目录路径；省略时检查当前活动文件")
                )
            )
        ),
        mapOf(
            "id" to "runConfiguration",
            "name" to "运行配置（Run）",
            "description" to "按名称以 Run 模式启动一个运行配置",
            "parametersSchema" to mapOf(
                "type" to "object",
                "properties" to mapOf(
                    "name" to mapOf("type" to "string", "description" to "运行配置名称")
                ),
                "required" to listOf("name")
            )
        ),
        mapOf(
            "id" to "debugConfiguration",
            "name" to "运行配置（Debug）",
            "description" to "按名称以 Debug 模式启动一个运行配置",
            "parametersSchema" to mapOf(
                "type" to "object",
                "properties" to mapOf(
                    "name" to mapOf("type" to "string", "description" to "运行配置名称")
                ),
                "required" to listOf("name")
            )
        ),
        mapOf(
            "id" to "stopRunConfiguration",
            "name" to "停止运行配置",
            "description" to "停止正在运行的运行配置进程；省略名称时停止最近启动的进程",
            "parametersSchema" to mapOf(
                "type" to "object",
                "properties" to mapOf(
                    "name" to mapOf("type" to "string", "description" to "可选的运行配置名称")
                )
            )
        )
    )
)

private fun terminalCategory(): Map<String, Any?> = mapOf(
    "id" to "terminal",
    "name" to "终端",
    "description" to "在 IDEA 终端中执行命令，或后台执行并获取输出",
    "status" to "connected",
    "tools" to listOf(
        mapOf(
            "id" to "sendToTerminal",
            "name" to "在终端中执行",
            "description" to "在 IDEA 终端标签中执行命令（对用户可见、可交互，不返回命令输出）",
            "parametersSchema" to mapOf(
                "type" to "object",
                "properties" to mapOf(
                    "command" to mapOf("type" to "string", "description" to "要执行的命令"),
                    "name" to mapOf("type" to "string", "description" to "可选终端标签名称"),
                    "workingDirectory" to mapOf("type" to "string", "description" to "可选工作目录")
                ),
                "required" to listOf("command")
            )
        ),
        mapOf(
            "id" to "runCommand",
            "name" to "后台执行并返回输出",
            "description" to "在后台执行命令并返回 stdout/stderr 与退出码（无交互能力）",
            "parametersSchema" to mapOf(
                "type" to "object",
                "properties" to mapOf(
                    "command" to mapOf("type" to "string", "description" to "要执行的命令"),
                    "workingDirectory" to mapOf("type" to "string", "description" to "可选工作目录"),
                    "timeoutMs" to mapOf("type" to "integer", "description" to "可选执行超时（毫秒，默认 30000，上限 55000）")
                ),
                "required" to listOf("command")
            )
        )
    )
)

private fun debugCategory(): Map<String, Any?> = mapOf(
    "id" to "debug",
    "name" to "运行和调试",
    "description" to "读取调试会话状态、调用栈与变量，管理断点并控制执行",
    "status" to "connected",
    "tools" to listOf(
        mapOf(
            "id" to "getDebugState",
            "name" to "查询调试状态",
            "description" to "返回当前调试会话列表与暂停状态",
            "parametersSchema" to mapOf("type" to "object", "properties" to emptyMap<String, Any>())
        ),
        mapOf(
            "id" to "getCallStack",
            "name" to "读取调用堆栈",
            "description" to "返回暂停会话的栈帧列表（文件、行号与帧标识）",
            "parametersSchema" to mapOf(
                "type" to "object",
                "properties" to mapOf(
                    "sessionId" to mapOf("type" to "integer", "description" to "可选调试会话标识；省略时使用当前会话")
                )
            )
        ),
        mapOf(
            "id" to "getVariables",
            "name" to "读取变量",
            "description" to "读取栈帧作用域或变量引用的值，可通过返回的 reference 继续展开子变量",
            "parametersSchema" to mapOf(
                "type" to "object",
                "properties" to mapOf(
                    "frameId" to mapOf("type" to "integer", "description" to "栈帧标识（来自 getCallStack）；省略时使用栈顶帧"),
                    "reference" to mapOf("type" to "integer", "description" to "变量引用标识，用于展开子变量"),
                    "sessionId" to mapOf("type" to "integer", "description" to "可选调试会话标识；省略时使用当前会话")
                )
            )
        ),
        mapOf(
            "id" to "listBreakpoints",
            "name" to "列出断点",
            "description" to "返回当前所有断点及其条件、命中次数与启用状态",
            "parametersSchema" to mapOf("type" to "object", "properties" to emptyMap<String, Any>())
        ),
        mapOf(
            "id" to "addLineBreakpoint",
            "name" to "添加行断点",
            "description" to "在指定文件行添加断点，可设置条件、命中次数或日志消息",
            "parametersSchema" to mapOf(
                "type" to "object",
                "properties" to mapOf(
                    "file" to mapOf("type" to "string", "description" to "目标文件的绝对或项目相对路径"),
                    "line" to mapOf("type" to "integer", "description" to "目标行号（从 1 开始）"),
                    "condition" to mapOf("type" to "string", "description" to "可选条件表达式，仅在为真时暂停"),
                    "hitCount" to mapOf("type" to "integer", "description" to "可选命中次数条件，>0 时生效"),
                    "logMessage" to mapOf("type" to "string", "description" to "可选日志消息表达式；设置后断点不暂停")
                ),
                "required" to listOf("file", "line")
            )
        ),
        mapOf(
            "id" to "addExceptionBreakpoint",
            "name" to "添加异常断点",
            "description" to "添加 Java 异常断点，可指定异常类与捕获/未捕获过滤",
            "parametersSchema" to mapOf(
                "type" to "object",
                "properties" to mapOf(
                    "exceptionClass" to mapOf("type" to "string", "description" to "可选异常类全限定名；省略时匹配所有异常"),
                    "caught" to mapOf("type" to "boolean", "description" to "是否在捕获的异常上暂停（默认 true）"),
                    "uncaught" to mapOf("type" to "boolean", "description" to "是否在未捕获的异常上暂停（默认 true）")
                )
            )
        ),
        mapOf(
            "id" to "removeBreakpoint",
            "name" to "删除断点",
            "description" to "按断点标识删除断点（标识来自 listBreakpoints，例如 bp3）",
            "parametersSchema" to mapOf(
                "type" to "object",
                "properties" to mapOf(
                    "id" to mapOf("type" to "string", "description" to "断点标识，例如 bp3")
                ),
                "required" to listOf("id")
            )
        ),
        mapOf(
            "id" to "controlExecution",
            "name" to "执行控制",
            "description" to "对暂停中的调试会话执行 resume、pause、stepOver、stepInto 或 stepOut",
            "parametersSchema" to mapOf(
                "type" to "object",
                "properties" to mapOf(
                    "action" to mapOf(
                        "type" to "string",
                        "enum" to listOf("resume", "pause", "stepOver", "stepInto", "stepOut"),
                        "description" to "执行控制动作"
                    ),
                    "sessionId" to mapOf("type" to "integer", "description" to "可选调试会话标识；省略时使用当前会话")
                ),
                "required" to listOf("action")
            )
        ),
        mapOf(
            "id" to "evaluateExpression",
            "name" to "表达式求值",
            "description" to "在暂停会话的指定栈帧上下文中求值表达式（会执行代码，请谨慎授权）",
            "parametersSchema" to mapOf(
                "type" to "object",
                "properties" to mapOf(
                    "expression" to mapOf("type" to "string", "description" to "要求值的表达式"),
                    "frameId" to mapOf("type" to "integer", "description" to "可选栈帧标识；省略时使用栈顶帧"),
                    "sessionId" to mapOf("type" to "integer", "description" to "可选调试会话标识；省略时使用当前会话")
                ),
                "required" to listOf("expression")
            )
        )
    ).filter { tool -> tool["id"] != "addExceptionBreakpoint" || javaDebuggerAvailable() }
)
