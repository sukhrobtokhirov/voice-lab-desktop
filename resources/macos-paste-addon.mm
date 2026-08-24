#include <node_api.h>
#include <Cocoa/Cocoa.h>
#include <ApplicationServices/ApplicationServices.h>
#include <cstring>
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

// Electron exposes a native NSView pointer on macOS through
// BrowserWindow#getNativeWindowHandle(). BrowserWindow deliberately does not
// expose NSWindow collection behaviour, which is the piece required for a
// status panel to occupy the menu-bar/notch line instead of the app work area.
bool GetNativeWindow(napi_env env, napi_value value, NSWindow** result) {
  bool isBuffer = false;
  napi_is_buffer(env, value, &isBuffer);
  if (!isBuffer) {
    napi_throw_type_error(env, nullptr, "Expected an Electron native window handle.");
    return false;
  }

  void* data = nullptr;
  size_t length = 0;
  napi_get_buffer_info(env, value, &data, &length);
  if (length < sizeof(void*)) {
    napi_throw_type_error(env, nullptr, "The Electron native window handle is invalid.");
    return false;
  }

  void* nativeViewPointer = nullptr;
  std::memcpy(&nativeViewPointer, data, sizeof(nativeViewPointer));
  if (nativeViewPointer == nullptr) {
    napi_throw_error(env, "NATIVE_WINDOW_UNAVAILABLE", "The macOS native window is unavailable.");
    return false;
  }

  NSView* nativeView = (__bridge NSView*)nativeViewPointer;
  NSWindow* window = nativeView.window;
  if (window == nil) {
    napi_throw_error(env, "NATIVE_WINDOW_UNAVAILABLE", "The macOS native window is unavailable.");
    return false;
  }

  *result = window;
  return true;
}

bool GetNumberArgument(napi_env env, napi_value value, double* result) {
  if (napi_get_value_double(env, value, result) != napi_ok) {
    napi_throw_type_error(env, nullptr, "Expected a numeric window coordinate.");
    return false;
  }
  return true;
}

// Set the actual NSPanel level and collection behaviour used by the macOS
// status-item layer. This is intentionally native: Electron has no
// BrowserWindow#setCollectionBehavior API.
napi_value ConfigureStatusPanel(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value args[3];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc != 3) {
    napi_throw_type_error(env, nullptr, "Expected a native window handle, x, and y.");
    return nullptr;
  }

  NSWindow* window = nil;
  double x = 0;
  double topY = 0;
  if (!GetNativeWindow(env, args[0], &window) || !GetNumberArgument(env, args[1], &x) ||
      !GetNumberArgument(env, args[2], &topY)) {
    return nullptr;
  }

  void (^configure)(void) = ^{
    // NSStatusWindowLevel is the documented AppKit level used by status items.
    // The flags keep this non-activating panel stationary across Spaces and
    // visible when another app enters full screen.
    [window setLevel:NSStatusWindowLevel];
    [window setCollectionBehavior:(NSWindowCollectionBehaviorCanJoinAllSpaces |
                                   NSWindowCollectionBehaviorFullScreenAuxiliary |
                                   NSWindowCollectionBehaviorStationary)];
    [window setHidesOnDeactivate:NO];

    NSScreen* targetScreen = window.screen ?: NSScreen.mainScreen;
    NSRect screenFrame = targetScreen.frame;
    NSRect frame = window.frame;
    const CGFloat nativeY = NSMaxY(screenFrame) - static_cast<CGFloat>(topY) - NSHeight(frame);
    [window setFrameOrigin:NSMakePoint(static_cast<CGFloat>(x), nativeY)];
    [window orderFrontRegardless];
  };

  if ([NSThread isMainThread]) {
    configure();
  } else {
    dispatch_sync(dispatch_get_main_queue(), configure);
  }

  return Boolean(env, true);
}

napi_value RestorePanelWindow(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc != 1) {
    napi_throw_type_error(env, nullptr, "Expected an Electron native window handle.");
    return nullptr;
  }

  NSWindow* window = nil;
  if (!GetNativeWindow(env, args[0], &window)) {
    return nullptr;
  }

  void (^restore)(void) = ^{
    [window setCollectionBehavior:NSWindowCollectionBehaviorDefault];
  };
  if ([NSThread isMainThread]) {
    restore();
  } else {
    dispatch_sync(dispatch_get_main_queue(), restore);
  }

  return Boolean(env, true);
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"isTrusted", nullptr, IsTrusted, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"paste", nullptr, Paste, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"configureStatusPanel", nullptr, ConfigureStatusPanel, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"restorePanelWindow", nullptr, RestorePanelWindow, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
