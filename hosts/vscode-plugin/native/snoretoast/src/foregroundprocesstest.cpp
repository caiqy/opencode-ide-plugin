#include "snoretoasts.h"
#include "toasteventhandler.h"
#include "utils.h"

#include <iostream>
#include <roapi.h>

namespace {
int fail(const char *message)
{
    std::cerr << message << std::endl;
    return 1;
}
}

int wmain()
{
    if (Utils::parseProcessId(L"")) return fail("expected empty pid to be rejected");
    if (Utils::parseProcessId(L"0")) return fail("expected zero pid to be rejected");
    if (Utils::parseProcessId(L"-1")) return fail("expected ASFW_ANY pid to be rejected");
    if (Utils::parseProcessId(L"12x")) return fail("expected non-numeric pid to be rejected");

    const auto validPid = Utils::parseProcessId(L"42");
    if (!validPid || *validPid != 42) return fail("expected pid 42 to parse");

    if (!Utils::normalizeImagePath(std::filesystem::path()).empty()) {
        return fail("expected empty image path to stay empty");
    }

    if (FAILED(Windows::Foundation::Initialize(RO_INIT_MULTITHREADED))) {
        return fail("expected Windows::Foundation::Initialize to succeed");
    }

    {
        SnoreToasts toast(L"caiqy.opencode-ui");
        toast.setForegroundProcessId(L"42");
        const auto defaultActivationArguments = toast.activationArguments();
        const auto clickedActivationArguments =
                toast.formatAction(SnoreToastActions::Actions::Clicked);
        if (defaultActivationArguments != clickedActivationArguments) {
            return fail("expected default activation arguments to stay callback payload");
        }
        if (!toast.activationType().empty()) {
            return fail("expected default activation type to stay implicit");
        }

        const std::wstring protocol =
                L"vscode://caiqy.opencode-ui/open-session?bridgeSessionID=bridge&sessionID=session";
        toast.setProtocol(protocol);
        if (toast.activationArguments() != protocol) {
            return fail("expected protocol URI to replace callback activation arguments");
        }
        if (toast.activationType() != L"protocol") {
            return fail("expected protocol activation type");
        }

        ToastEventHandler handler(toast);
        if (FAILED(handler.Invoke(static_cast<ABI::Windows::UI::Notifications::IToastNotification *>(nullptr),
                                  static_cast<IInspectable *>(nullptr)))) {
            return fail("expected protocol activation handler to succeed without payload");
        }
        if (WaitForSingleObject(handler.event(), 0) != WAIT_OBJECT_0) {
            return fail("expected protocol activation handler to signal the event");
        }
        if (handler.userAction() != SnoreToastActions::Actions::Clicked) {
            return fail("expected protocol activation handler to record Clicked");
        }

        const auto activation = toast.formatAction(SnoreToastActions::Actions::Clicked);
        const auto data = Utils::splitData(activation);

        const auto foregroundProcessId = data.find(L"foregroundProcessId");
        if (foregroundProcessId == data.cend() || foregroundProcessId->second != L"42") {
            Windows::Foundation::Uninitialize();
            return fail("expected activation payload to carry foregroundProcessId");
        }
    }

    Windows::Foundation::Uninitialize();
    return 0;
}
