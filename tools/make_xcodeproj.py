"""Generate ClearQuotes.xcodeproj (macOS app + WidgetKit extension) deterministically.

Run from anywhere: python3 tools/make_xcodeproj.py  (rewrites the .xcodeproj and the shared scheme).
Add new source files to the `fr`/`bf_*` lists below rather than hand-editing project.pbxproj.
"""
import hashlib
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # project folder
PROJ = os.path.join(ROOT, "ClearQuotes.xcodeproj")


def oid(name):
    return hashlib.md5(("ClearQuotes:" + name).encode()).hexdigest()[:24].upper()


SAFE = re.compile(r"^[A-Za-z0-9_$/:.]+$")


def q(v):
    if isinstance(v, int):
        return str(v)
    s = str(v)
    if SAFE.match(s):
        return s
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def ser(v, indent):
    pad = "\t" * indent
    if isinstance(v, dict):
        out = "{\n"
        for k, val in v.items():
            out += f"{pad}\t{q(k)} = {ser(val, indent + 1)};\n"
        return out + pad + "}"
    if isinstance(v, list):
        out = "(\n"
        for item in v:
            out += f"{pad}\t{ser(item, indent + 1)},\n"
        return out + pad + ")"
    return q(v)


objects = {}


def add(key, isa, **fields):
    i = oid(key)
    objects[i] = dict(isa=isa, **fields)
    return i


# ---- file references
def fref(name, path, ftype):
    return add("fr:" + name, "PBXFileReference", lastKnownFileType=ftype, path=path, sourceTree="<group>")


fr = {
    "app": fref("app", "ClearQuotesApp.swift", "sourcecode.swift"),
    "content": fref("content", "ContentView.swift", "sourcecode.swift"),
    "assets": fref("assets", "Assets.xcassets", "folder.assetcatalog"),
    "appent": fref("appent", "ClearQuotes.entitlements", "text.plist.entitlements"),
    "appinfo": fref("appinfo", "Info.plist", "text.plist.xml"),
    "widget": fref("widget", "ClearQuotesWidget.swift", "sourcecode.swift"),
    "winfo": fref("winfo", "Info.plist", "text.plist.xml"),
    "went": fref("went", "ClearQuotesWidget.entitlements", "text.plist.entitlements"),
    "engine": fref("engine", "QuoteEngine.swift", "sourcecode.swift"),
    "card": fref("card", "QuoteCardView.swift", "sourcecode.swift"),
    "script": fref("script", "James Clear 3-2-1.js", "sourcecode.javascript"),
    "readme": fref("readme", "README.md", "net.daringfireball.markdown"),
}
prod_app = add("prod:app", "PBXFileReference", explicitFileType="wrapper.application", includeInIndex=0,
               path="ClearQuotes.app", sourceTree="BUILT_PRODUCTS_DIR")
prod_appex = add("prod:appex", "PBXFileReference", explicitFileType="wrapper.app-extension", includeInIndex=0,
                 path="ClearQuotesWidgetExtension.appex", sourceTree="BUILT_PRODUCTS_DIR")


# ---- build files
def bfile(name, ref, **extra):
    return add("bf:" + name, "PBXBuildFile", fileRef=ref, **extra)


bf_app = [bfile("app.app", fr["app"]), bfile("app.content", fr["content"]),
          bfile("app.engine", fr["engine"]), bfile("app.card", fr["card"])]
bf_app_res = [bfile("app.assets", fr["assets"])]
bf_embed = bfile("app.embed", prod_appex, settings={"ATTRIBUTES": ["RemoveHeadersOnCopy"]})
bf_widget = [bfile("w.widget", fr["widget"]), bfile("w.engine", fr["engine"]), bfile("w.card", fr["card"])]

# ---- groups
g_app = add("g:app", "PBXGroup", children=[fr["app"], fr["content"], fr["assets"], fr["appinfo"], fr["appent"]], path="App", sourceTree="<group>")
g_widget = add("g:widget", "PBXGroup", children=[fr["widget"], fr["winfo"], fr["went"]], path="Widget", sourceTree="<group>")
g_shared = add("g:shared", "PBXGroup", children=[fr["engine"], fr["card"]], path="Shared", sourceTree="<group>")
g_iphone = add("g:iphone", "PBXGroup", children=[fr["script"]], path="iPhone", sourceTree="<group>")
g_products = add("g:products", "PBXGroup", children=[prod_app, prod_appex], name="Products", sourceTree="<group>")
g_main = add("g:main", "PBXGroup", children=[fr["readme"], g_app, g_widget, g_shared, g_iphone, g_products], sourceTree="<group>")

# ---- build phases
src_app = add("ph:src.app", "PBXSourcesBuildPhase", buildActionMask=2147483647, files=bf_app, runOnlyForDeploymentPostprocessing=0)
fw_app = add("ph:fw.app", "PBXFrameworksBuildPhase", buildActionMask=2147483647, files=[], runOnlyForDeploymentPostprocessing=0)
res_app = add("ph:res.app", "PBXResourcesBuildPhase", buildActionMask=2147483647, files=bf_app_res, runOnlyForDeploymentPostprocessing=0)
embed = add("ph:embed", "PBXCopyFilesBuildPhase", buildActionMask=2147483647, dstPath="", dstSubfolderSpec=13,
            files=[bf_embed], name="Embed Foundation Extensions", runOnlyForDeploymentPostprocessing=0)
src_w = add("ph:src.w", "PBXSourcesBuildPhase", buildActionMask=2147483647, files=bf_widget, runOnlyForDeploymentPostprocessing=0)
fw_w = add("ph:fw.w", "PBXFrameworksBuildPhase", buildActionMask=2147483647, files=[], runOnlyForDeploymentPostprocessing=0)
res_w = add("ph:res.w", "PBXResourcesBuildPhase", buildActionMask=2147483647, files=[], runOnlyForDeploymentPostprocessing=0)

# The optional personal archive backup (Fallback/archive.json, git-ignored; see Fallback/README.md) is
# copied into each bundle's Resources when it exists, and removed from the bundle when it doesn't.
# Declaring the output makes Xcode re-sign the bundle after the copy.
ARCHIVE_SCRIPT = """SRC="${SRCROOT}/Fallback/archive.json"
DST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/archive.json"
if [ -f "$SRC" ]; then
  mkdir -p "$(dirname "$DST")" && cp "$SRC" "$DST"
else
  rm -f "$DST"
fi
"""


def archive_phase(key):
    return add(key, "PBXShellScriptBuildPhase", alwaysOutOfDate=1, buildActionMask=2147483647, files=[],
               inputFileListPaths=[], inputPaths=[], name="Copy archive backup (if any)", outputFileListPaths=[],
               outputPaths=["$(TARGET_BUILD_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)/archive.json"], runOnlyForDeploymentPostprocessing=0, shellPath="/bin/sh", shellScript=ARCHIVE_SCRIPT,
               showEnvVarsInLog=0)


arch_app = archive_phase("ph:archive.app")
arch_w = archive_phase("ph:archive.w")

# ---- build configurations
common = {
    "ALWAYS_SEARCH_USER_PATHS": "NO",
    "ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS": "YES",
    "BUNDLE_ID_PREFIX": "se.ulfgran",
    "CLANG_ANALYZER_NONNULL": "YES",
    "CLANG_CXX_LANGUAGE_STANDARD": "gnu++20",
    "CLANG_ENABLE_MODULES": "YES",
    "CLANG_ENABLE_OBJC_ARC": "YES",
    "CLANG_ENABLE_OBJC_WEAK": "YES",
    "COPY_PHASE_STRIP": "NO",
    "ENABLE_STRICT_OBJC_MSGSEND": "YES",
    "ENABLE_USER_SCRIPT_SANDBOXING": "YES",
    "GCC_C_LANGUAGE_STANDARD": "gnu17",
    "GCC_NO_COMMON_BLOCKS": "YES",
    "MACOSX_DEPLOYMENT_TARGET": "14.0",
    "MTL_FAST_MATH": "YES",
    "SDKROOT": "macosx",
}
proj_debug = dict(common, **{
    "DEBUG_INFORMATION_FORMAT": "dwarf",
    "ENABLE_TESTABILITY": "YES",
    "GCC_DYNAMIC_NO_PIC": "NO",
    "GCC_OPTIMIZATION_LEVEL": "0",
    "GCC_PREPROCESSOR_DEFINITIONS": ["DEBUG=1", "$(inherited)"],
    "MTL_ENABLE_DEBUG_INFO": "INCLUDE_SOURCE",
    "ONLY_ACTIVE_ARCH": "YES",
    "SWIFT_ACTIVE_COMPILATION_CONDITIONS": "DEBUG $(inherited)",
    "SWIFT_OPTIMIZATION_LEVEL": "-Onone",
})
proj_release = dict(common, **{
    "DEBUG_INFORMATION_FORMAT": "dwarf-with-dsym",
    "ENABLE_NS_ASSERTIONS": "NO",
    "MTL_ENABLE_DEBUG_INFO": "NO",
    "SWIFT_COMPILATION_MODE": "wholemodule",
})
app_settings = {
    "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
    "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME": "AccentColor",
    "CODE_SIGN_ENTITLEMENTS": "App/ClearQuotes.entitlements",
    "CODE_SIGN_STYLE": "Automatic",
    "COMBINE_HIDPI_IMAGES": "YES",
    "CURRENT_PROJECT_VERSION": "1",
    "DEVELOPMENT_TEAM": "",
    "ENABLE_HARDENED_RUNTIME": "YES",
    "ENABLE_PREVIEWS": "YES",
    "ENABLE_USER_SCRIPT_SANDBOXING": "NO",  # the archive phase reads Fallback/, which may not exist
    "GENERATE_INFOPLIST_FILE": "YES",
    "INFOPLIST_FILE": "App/Info.plist",
    "INFOPLIST_KEY_CFBundleDisplayName": "James Clear 3-2-1",
    "INFOPLIST_KEY_LSApplicationCategoryType": "public.app-category.lifestyle",
    "INFOPLIST_KEY_NSHumanReadableCopyright": "",
    "LD_RUNPATH_SEARCH_PATHS": ["$(inherited)", "@executable_path/../Frameworks"],
    "MARKETING_VERSION": "1.0",
    "PRODUCT_BUNDLE_IDENTIFIER": "$(BUNDLE_ID_PREFIX).ClearQuotes",
    "PRODUCT_NAME": "$(TARGET_NAME)",
    "SWIFT_EMIT_LOC_STRINGS": "YES",
    "SWIFT_VERSION": "5.0",
}
widget_settings = {
    "CODE_SIGN_ENTITLEMENTS": "Widget/ClearQuotesWidget.entitlements",
    "CODE_SIGN_STYLE": "Automatic",
    "CURRENT_PROJECT_VERSION": "1",
    "DEVELOPMENT_TEAM": "",
    "ENABLE_HARDENED_RUNTIME": "YES",
    "ENABLE_PREVIEWS": "YES",
    "ENABLE_USER_SCRIPT_SANDBOXING": "NO",  # the archive phase reads Fallback/, which may not exist
    "GENERATE_INFOPLIST_FILE": "YES",
    "INFOPLIST_FILE": "Widget/Info.plist",
    "INFOPLIST_KEY_CFBundleDisplayName": "James Clear 3-2-1",
    "INFOPLIST_KEY_NSHumanReadableCopyright": "",
    "LD_RUNPATH_SEARCH_PATHS": ["$(inherited)", "@executable_path/../Frameworks", "@executable_path/../../../../Frameworks"],
    "MARKETING_VERSION": "1.0",
    "PRODUCT_BUNDLE_IDENTIFIER": "$(BUNDLE_ID_PREFIX).ClearQuotes.Widget",
    "PRODUCT_NAME": "$(TARGET_NAME)",
    "SKIP_INSTALL": "YES",
    "SWIFT_EMIT_LOC_STRINGS": "YES",
    "SWIFT_VERSION": "5.0",
}


def config_list(prefix, debug, release):
    d = add(f"bc:{prefix}.debug", "XCBuildConfiguration", buildSettings=debug, name="Debug")
    r = add(f"bc:{prefix}.release", "XCBuildConfiguration", buildSettings=release, name="Release")
    return add(f"cl:{prefix}", "XCConfigurationList", buildConfigurations=[d, r],
               defaultConfigurationIsVisible=0, defaultConfigurationName="Release")


cl_proj = config_list("project", proj_debug, proj_release)
cl_app = config_list("app", app_settings, app_settings)
cl_widget = config_list("widget", widget_settings, widget_settings)

# ---- targets
T_APP, T_WIDGET, PROJECT = oid("t:app"), oid("t:widget"), oid("project")
proxy = add("proxy:widget", "PBXContainerItemProxy", containerPortal=PROJECT, proxyType=1,
            remoteGlobalIDString=T_WIDGET, remoteInfo="ClearQuotesWidgetExtension")
dep = add("dep:widget", "PBXTargetDependency", target=T_WIDGET, targetProxy=proxy)
objects[T_APP] = dict(isa="PBXNativeTarget", buildConfigurationList=cl_app,
                      buildPhases=[src_app, fw_app, res_app, arch_app, embed], buildRules=[], dependencies=[dep],
                      name="ClearQuotes", productName="ClearQuotes", productReference=prod_app,
                      productType="com.apple.product-type.application")
objects[T_WIDGET] = dict(isa="PBXNativeTarget", buildConfigurationList=cl_widget,
                         buildPhases=[src_w, fw_w, res_w, arch_w], buildRules=[], dependencies=[],
                         name="ClearQuotesWidgetExtension", productName="ClearQuotesWidgetExtension",
                         productReference=prod_appex, productType="com.apple.product-type.app-extension")
objects[PROJECT] = dict(
    isa="PBXProject",
    attributes={
        "BuildIndependentTargetsInParallel": 1,
        "LastSwiftUpdateCheck": 1500,
        "LastUpgradeCheck": 1500,
        "TargetAttributes": {T_APP: {"CreatedOnToolsVersion": "15.0"}, T_WIDGET: {"CreatedOnToolsVersion": "15.0"}},
    },
    buildConfigurationList=cl_proj,
    compatibilityVersion="Xcode 14.0",
    developmentRegion="en",
    hasScannedForEncodings=0,
    knownRegions=["en", "Base"],
    mainGroup=g_main,
    productRefGroup=g_products,
    projectDirPath="",
    projectRoot="",
    targets=[T_APP, T_WIDGET],
)

# ---- write project.pbxproj (objects grouped by isa, like Xcode)
order = ["PBXBuildFile", "PBXContainerItemProxy", "PBXCopyFilesBuildPhase", "PBXFileReference",
         "PBXFrameworksBuildPhase", "PBXGroup", "PBXNativeTarget", "PBXProject", "PBXResourcesBuildPhase",
         "PBXShellScriptBuildPhase", "PBXSourcesBuildPhase", "PBXTargetDependency", "XCBuildConfiguration", "XCConfigurationList"]
lines = ["// !$*UTF8*$!", "{", "\tarchiveVersion = 1;", "\tclasses = {", "\t};", "\tobjectVersion = 56;", "\tobjects = {"]
for isa in order:
    ids = sorted(i for i, o in objects.items() if o["isa"] == isa)
    if not ids:
        continue
    lines.append(f"\n/* Begin {isa} section */")
    for i in ids:
        o = dict(objects[i])
        body = {"isa": o.pop("isa")}
        body.update(o)
        lines.append(f"\t\t{i} = {ser(body, 2)};")
    lines.append(f"/* End {isa} section */")
lines += ["\t};", f"\trootObject = {PROJECT};", "}", ""]
os.makedirs(PROJ, exist_ok=True)
with open(os.path.join(PROJ, "project.pbxproj"), "w") as f:
    f.write("\n".join(lines))

# ---- shared scheme for the app
ref = (f'            <BuildableReference\n               BuildableIdentifier = "primary"\n'
       f'               BlueprintIdentifier = "{T_APP}"\n               BuildableName = "ClearQuotes.app"\n'
       f'               BlueprintName = "ClearQuotes"\n               ReferencedContainer = "container:ClearQuotes.xcodeproj">\n'
       f'            </BuildableReference>')
scheme = f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme
   LastUpgradeVersion = "1500"
   version = "1.7">
   <BuildAction
      parallelizeBuildables = "YES"
      buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry
            buildForTesting = "YES"
            buildForRunning = "YES"
            buildForProfiling = "YES"
            buildForArchiving = "YES"
            buildForAnalyzing = "YES">
{ref}
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      shouldUseLaunchSchemeArgsEnv = "YES"
      shouldAutocreateTestPlan = "YES">
   </TestAction>
   <LaunchAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      launchStyle = "0"
      useCustomWorkingDirectory = "NO"
      ignoresPersistentStateOnLaunch = "NO"
      debugDocumentVersioning = "YES"
      debugServiceExtension = "internal"
      allowLocationSimulation = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
{ref}
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction
      buildConfiguration = "Release"
      shouldUseLaunchSchemeArgsEnv = "YES"
      savedToolIdentifier = ""
      useCustomWorkingDirectory = "NO"
      debugDocumentVersioning = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
{ref}
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction
      buildConfiguration = "Debug">
   </AnalyzeAction>
   <ArchiveAction
      buildConfiguration = "Release"
      revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>
'''
sdir = os.path.join(PROJ, "xcshareddata", "xcschemes")
os.makedirs(sdir, exist_ok=True)
with open(os.path.join(sdir, "ClearQuotes.xcscheme"), "w") as f:
    f.write(scheme)
print("objects:", len(objects), "app target:", T_APP, "widget target:", T_WIDGET)
