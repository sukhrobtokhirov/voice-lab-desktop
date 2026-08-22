#include <node_api.h>
#include <ApplicationServices/ApplicationServices.h>
#include <unistd.h>

namespace {

napi_value Boolean(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

napi_value IsTrusted(napi_env env, napi_callback_info) {
  return Boolean(env, AXIsProcessTrusted());
}

napi_value Paste(napi_env env, napi_callback_info) {
  if (!AXIsProcessTrusted()) {
    napi_throw_error(env, "PASTE_ACCESSIBILITY_REQUIRED", "VoiceLab does not have Accessibility access.");
    return nullptr;
  }

  CGEventRef keyDown = CGEventCreateKeyboardEvent(nullptr, static_cast<CGKeyCode>(0x09), true);
  CGEventRef keyUp = CGEventCreateKeyboardEvent(nullptr, static_cast<CGKeyCode>(0x09), false);
  if (keyDown == nullptr || keyUp == nullptr) {
    if (keyDown != nullptr) CFRelease(keyDown);
    if (keyUp != nullptr) CFRelease(keyUp);
    napi_throw_error(env, "PASTE_EVENT_CREATION_FAILED", "VoiceLab could not create the paste event.");
    return nullptr;
  }

  CGEventSetFlags(keyDown, kCGEventFlagMaskCommand);
  CGEventSetFlags(keyUp, kCGEventFlagMaskCommand);
  CGEventPost(kCGSessionEventTap, keyDown);
  usleep(8000);
  CGEventPost(kCGSessionEventTap, keyUp);
  usleep(20000);
  CFRelease(keyDown);
  CFRelease(keyUp);

  return Boolean(env, true);
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"isTrusted", nullptr, IsTrusted, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"paste", nullptr, Paste, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
