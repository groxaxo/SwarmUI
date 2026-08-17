using SwarmUI.Core;

namespace SwarmUI.Builtin_VideoWorkspace;

/// <summary>Adds the video component, recreation, queue, and GPU-routing workspace to the Generate tab.</summary>
public class VideoWorkspaceExtension : Extension
{
    /// <inheritdoc/>
    public override void OnPreInit()
    {
        ScriptFiles.Add("Assets/video_workspace_00_base.js");
        ScriptFiles.Add("Assets/video_workspace_01_methods.js");
        ScriptFiles.Add("Assets/video_workspace_02_methods.js");
        ScriptFiles.Add("Assets/video_workspace_03_methods.js");
        ScriptFiles.Add("Assets/video_workspace_04_methods.js");
        ScriptFiles.Add("Assets/video_workspace_05_methods.js");
        ScriptFiles.Add("Assets/video_workspace_06_methods.js");
        ScriptFiles.Add("Assets/video_workspace_07_methods.js");
        ScriptFiles.Add("Assets/video_workspace_08_methods.js");
        ScriptFiles.Add("Assets/video_workspace_09_methods.js");
        ScriptFiles.Add("Assets/video_workspace_10_methods.js");
        ScriptFiles.Add("Assets/video_workspace_11_methods.js");
        ScriptFiles.Add("Assets/video_workspace_12_methods.js");
        ScriptFiles.Add("Assets/video_workspace_13_init.js");
        StyleSheetFiles.Add("Assets/video_workspace.css");
    }
}
