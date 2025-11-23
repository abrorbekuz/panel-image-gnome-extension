// extension.js
import GObject from "gi://GObject";
import St from "gi://St";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

// Get Quick Settings elements
let QuickSettingsMenu = null;
let QuickSettingsBox = null;
let QuickSettingsActor = null;

function getQuickSettings() {
  const quickSettings = Main.panel.statusArea.quickSettings;
  if (quickSettings && quickSettings.menu) {
    QuickSettingsMenu = quickSettings.menu;
    QuickSettingsBox = quickSettings.menu.box;
    QuickSettingsActor = quickSettings.menu.actor;
  }
}

// Image banner widget
const ImageBanner = GObject.registerClass(
  class ImageBanner extends St.Button {
    _init(settings, extensionPath) {
      super._init({
        style_class: "image-banner",
        can_focus: true,
        x_expand: true,
        x_align: Clutter.ActorAlign.FILL,
      });

      this._settings = settings;
      this._extensionPath = extensionPath;
      this._currentImageIndex = 0;
      this._hoverImages = [];

      // Create container
      this._container = new St.Bin({
        x_expand: true,
        x_align: Clutter.ActorAlign.FILL,
      });

      this.set_child(this._container);

      // Update image
      this._updateImage();

      // Setup hover image switching
      this._setupHoverEffect();

      // Connect click event
      this.connect("clicked", () => {
        this._executeScript();
      });

      // Listen for settings changes
      this._settingsChangedId = this._settings.connect("changed", () => {
        this._updateImage();
        this._setupHoverEffect();
      });
    }

    _setupHoverEffect() {
      // Disconnect previous handlers
      if (this._motionEventId) {
        this.disconnect(this._motionEventId);
        this._motionEventId = null;
      }
      if (this._leaveEventId) {
        this.disconnect(this._leaveEventId);
        this._leaveEventId = null;
      }

      const hoverEnabled = this._settings.get_boolean("hover-images-enabled");

      if (hoverEnabled) {
        const hoverImagesStr = this._settings.get_string("hover-images");
        const mainImagePath =
          this._settings.get_string("image-path") ||
          `${this._extensionPath}/assets/get-it-on-ego.svg`;

        // Start with main image as first in queue
        this._hoverImages = [mainImagePath];

        if (hoverImagesStr) {
          // Parse comma-separated paths and add them
          const additionalImages = hoverImagesStr
            .split(",")
            .map((p) => p.trim())
            .filter((p) => p.length > 0);
          this._hoverImages = this._hoverImages.concat(additionalImages);
        }

        if (this._hoverImages.length > 1) {
          // Connect motion event for hover tracking
          this._motionEventId = this.connect("motion-event", (actor, event) => {
            return this._onMotionEvent(actor, event);
          });

          // Reset to original image on leave
          this._leaveEventId = this.connect("leave-event", () => {
            this._currentImageIndex = 0;
            this._updateImage();
          });
        }
      } else {
        this._hoverImages = [];
      }
    }

    _onMotionEvent(actor, event) {
      if (this._hoverImages.length === 0) {
        return Clutter.EVENT_PROPAGATE;
      }

      // Get mouse position relative to the banner
      const [x, y] = event.get_coords();
      const [actorX, actorY] = actor.get_transformed_position();
      const [width, height] = actor.get_size();

      // Calculate relative position (0 to 1)
      const relativeX = (x - actorX) / width;

      // Determine which image to show based on horizontal position
      const imageIndex = Math.floor(relativeX * this._hoverImages.length);
      const clampedIndex = Math.max(
        0,
        Math.min(imageIndex, this._hoverImages.length - 1)
      );

      // Only update if changed
      if (clampedIndex !== this._currentImageIndex) {
        this._currentImageIndex = clampedIndex;
        this._showHoverImage(this._hoverImages[clampedIndex]);
      }

      return Clutter.EVENT_PROPAGATE;
    }

    _showHoverImage(imagePath) {
      const file = Gio.File.new_for_path(imagePath);

      if (file.query_exists(null)) {
        const height = this._settings.get_int("image-height");
        const heightStyle =
          height > 0 ? `min-height: ${height}px;` : "min-height: 100px;";

        this._container.child = null;
        this._container.style = `
                background-image: url("${imagePath}");
                background-size: 100% 100%;
                border-radius: 16px;
                background-repeat: no-repeat;
                background-position: center;
                ${heightStyle}
                width: 100%;
            `;
      }
    }

    _updateImage() {
      const imagePath =
        this._settings.get_string("image-path") ||
        `${this._extensionPath}/assets/get-it-on-ego.svg`;
      const height = this._settings.get_int("image-height");

      const file = Gio.File.new_for_path(imagePath);

      if (file.query_exists(null)) {
        this._container.child = null;

        const heightStyle =
          height > 0 ? `min-height: ${height}px;` : "min-height: 100px;";

        this._container.style = `
            background-image: url("${imagePath}");
            background-size: 100% 100%;
            border-radius: 16px;
            background-repeat: no-repeat;
            background-position: center;
            ${heightStyle}
            width: 100%;
        `;
      } else {
        this._container.style = "";
        const label = new St.Label({
          text: "Image not found: " + imagePath,
          style_class: "image-placeholder",
        });
        this._container.child = label;
      }
    }

    _executeScript() {
      const scriptPath = this._settings.get_string("script-path");
      if (!scriptPath || scriptPath === "") {
        return;
      }

      try {
        GLib.spawn_command_line_async(scriptPath);
      } catch (e) {
        log(`Error executing script: ${e.message}`);
      }
    }

    destroy() {
      if (this._motionEventId) {
        this.disconnect(this._motionEventId);
        this._motionEventId = null;
      }
      if (this._leaveEventId) {
        this.disconnect(this._leaveEventId);
        this._leaveEventId = null;
      }
      if (this._settingsChangedId) {
        this._settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = null;
      }
      super.destroy();
    }
  }
);

// Main extension class
export default class ImageQuickSettingsExtension extends Extension {
  enable() {
    this._settings = this.getSettings();

    getQuickSettings();

    this._addBanner();

    // Listen for settings changes
    this._settingsChangedIds = [
      this._settings.connect("changed::detached", () => this._reload()),
      this._settings.connect("changed::position", () => this._reload()),
      this._settings.connect("changed::gap", () => this._reload()),
    ];
  }

  _addBanner() {
    const detached = this._settings.get_boolean("detached");
    const position = this._settings.get_string("position");
    const gap = this._settings.get_int("gap");

    // Create banner
    this._banner = new ImageBanner(this._settings, this.path);

    // Store original style classes
    this._originalBoxStyle = QuickSettingsBox.style_class;
    this._originalActorStyle = QuickSettingsActor.style_class;

    if (detached) {
      // Detached mode: manipulate style classes like the reference extension
      QuickSettingsBox.style_class = "";
      QuickSettingsActor.style_class = " " + QuickSettingsActor.style_class;

      // Get the first child (the actual quick settings grid)
      const quickSettingsGrid = QuickSettingsBox.first_child;

      if (quickSettingsGrid) {
        // Store original grid style
        this._originalGridStyle = quickSettingsGrid.style_class;
        quickSettingsGrid.style_class =
          quickSettingsGrid.style_class + " popup-menu-content quick-settings";

        // Add banner based on position
        if (position === "top") {
          // Insert at the beginning
          QuickSettingsBox.insert_child_at_index(this._banner, 0);
          this._banner.style_class = "image-banner image-banner-detached";
          this._banner.style = `margin-bottom: ${gap}px;`;
        } else {
          // Bottom: add banner after the grid
          QuickSettingsBox.add_child(this._banner);
          this._banner.style_class = "image-banner image-banner-detached";
          this._banner.style = `margin-top: ${gap}px;`;
        }
      }
    } else {
      // Integrated mode: add directly to QuickSettingsBox (menu.box)
      // This places it as a real child in the vertical layout, not overlapping
      if (position === "top") {
        QuickSettingsBox.insert_child_at_index(this._banner, 0);
        this._banner.style = `margin-bottom: ${gap}px;`;
      } else {
        QuickSettingsBox.add_child(this._banner);
        this._banner.style = `margin-top: ${gap}px;`;
      }
    }
  }

  _reload() {
    this._removeBanner();
    this._addBanner();
  }

  _removeBanner() {
    if (this._banner) {
      const parent = this._banner.get_parent();
      if (parent) {
        parent.remove_child(this._banner);
      }
      this._banner.destroy();
      this._banner = null;
    }

    // Restore original styles
    if (this._originalBoxStyle) {
      QuickSettingsBox.style_class = this._originalBoxStyle;
      this._originalBoxStyle = null;
    }

    if (this._originalActorStyle) {
      QuickSettingsActor.style_class = this._originalActorStyle;
      this._originalActorStyle = null;
    }

    if (this._originalGridStyle) {
      const quickSettingsGrid = QuickSettingsBox.first_child;
      if (quickSettingsGrid) {
        quickSettingsGrid.style_class = this._originalGridStyle;
      }
      this._originalGridStyle = null;
    }
  }

  disable() {
    if (this._settingsChangedIds) {
      this._settingsChangedIds.forEach((id) => this._settings.disconnect(id));
      this._settingsChangedIds = null;
    }

    this._removeBanner();
    this._settings = null;
  }
}
