using SwarmUI.Core;

namespace SwarmUI.Builtin_VideoWorkspace;

/// <summary>Adds the video component, recreation, queue, and GPU-routing workspace to the Generate tab.</summary>
public class VideoWorkspaceExtension : Extension
{
    /// <inheritdoc/>
    public override void OnPreInit()
    {
        ScriptFiles.Add("Assets/video_workspace.js");
        StyleSheetFiles.Add("Assets/video_workspace.css");
    }
}
