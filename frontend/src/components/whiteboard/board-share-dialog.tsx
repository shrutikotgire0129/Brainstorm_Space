"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import { getRoomOwnerToken } from "@/lib/room-owner";

type Permission = "VIEWER" | "EDITOR";
type AccessMode = "INSTANT" | "APPROVAL";

type ShareSettings = {
  id: string;
  permission: Permission;
  accessMode: AccessMode;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type Invitation = {
  id: string;
  roomId: string;
  permission: Permission;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type Props = {
  roomId: string;
  onClose: () => void;
};

function toLocalDateTime(value: string | null): string {
  if (!value) return "";

  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;

  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toISOString(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function formatDate(value: string | null): string {
  if (!value) return "No expiration";

  return new Date(value).toLocaleString();
}

export default function BoardShareDialog({ roomId, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [enabled, setEnabled] = useState(false);
  const [settings, setSettings] = useState<ShareSettings | null>(null);

  const [permission, setPermission] = useState<Permission>("VIEWER");
  const [accessMode, setAccessMode] = useState<AccessMode>("INSTANT");
  const [shareExpiry, setShareExpiry] = useState("");
  const [shareUrl, setShareUrl] = useState("");

  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [invitePermission, setInvitePermission] =
    useState<Permission>("VIEWER");
  const [inviteExpiry, setInviteExpiry] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");

  const getHeaders = useCallback(() => {
    const token = getRoomOwnerToken(roomId);

    if (!token) {
      throw new Error("Creator authorization is unavailable.");
    }

    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }, [roomId]);

  const loadData = useCallback(async () => {
    try {
      const headers = getHeaders();

      const [shareResponse, invitationResponse] = await Promise.all([
        fetch(`${API_URL}/api/rooms/${roomId}/share-link`, {
          headers,
        }),
        fetch(`${API_URL}/api/rooms/${roomId}/invitations`, {
          headers,
        }),
      ]);

      const shareResult = await shareResponse.json();
      const invitationResult = await invitationResponse.json();

      if (!shareResponse.ok || !shareResult.success) {
        throw new Error(
          shareResult.message || "Failed to load sharing settings.",
        );
      }

      if (!invitationResponse.ok || !invitationResult.success) {
        throw new Error(
          invitationResult.message || "Failed to load invitations.",
        );
      }

      const loadedSettings: ShareSettings | null = shareResult.data.settings;

      setEnabled(shareResult.data.enabled);
      setSettings(loadedSettings);

      if (loadedSettings) {
        setPermission(loadedSettings.permission);
        setAccessMode(loadedSettings.accessMode);
        setShareExpiry(toLocalDateTime(loadedSettings.expiresAt));
      }

      setInvitations(invitationResult.data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load sharing data.",
      );
    } finally {
      setLoading(false);
    }
  }, [getHeaders, roomId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadData]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, saving]);

  async function handleShareLinkSave(rotateLink = false) {
    setSaving(true);
    setError("");
    setNotice("");

    if (rotateLink || !enabled) {
      setShareUrl("");
    }

    try {
      const headers = getHeaders();

      const body = {
        permission,
        accessMode,
        expiresAt: toISOString(shareExpiry),
      };

      const response = await fetch(
        `${API_URL}/api/rooms/${roomId}/share-link`,
        {
          method: enabled && !rotateLink ? "PATCH" : "POST",
          headers,
          body: JSON.stringify(body),
        },
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to save share settings.");
      }

      if (result.data.token) {
        setShareUrl(`${window.location.origin}/join/${result.data.token}`);
        setNotice(
          "New link generated. Copy it now; its token cannot be retrieved again.",
        );
      } else {
        setNotice("Sharing settings updated successfully.");
      }

      await loadData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save share settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleShareLinkRevoke() {
    if (!window.confirm("Disable this link and revoke its guest access?")) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    setShareUrl("");

    try {
      const response = await fetch(
        `${API_URL}/api/rooms/${roomId}/share-link`,
        {
          method: "DELETE",
          headers: getHeaders(),
        },
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to revoke share link.");
      }

      setNotice("Share link disabled.");
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to revoke share link.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleInvitationCreate() {
    setSaving(true);
    setError("");
    setNotice("");
    setInviteUrl("");

    try {
      const response = await fetch(
        `${API_URL}/api/rooms/${roomId}/invitations`,
        {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({
            permission: invitePermission,
            expiresAt: toISOString(inviteExpiry),
          }),
        },
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to create invitation.");
      }

      setInviteUrl(`${window.location.origin}/join/${result.data.token}`);
      setNotice(
        "Invitation generated. Copy it now; its token cannot be retrieved again.",
      );

      setInviteExpiry("");
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create invitation.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleInvitationRevoke(inviteId: string) {
    if (!window.confirm("Revoke this invitation and its guest access?")) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(
        `${API_URL}/api/rooms/${roomId}/invitations/${inviteId}`,
        {
          method: "DELETE",
          headers: getHeaders(),
        },
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to revoke invitation.");
      }

      setNotice("Invitation revoked.");
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to revoke invitation.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Link copied to clipboard.");
      setError("");
    } catch {
      setError("Could not copy automatically. Please copy the link manually.");
    }
  }

  return (
    <div
      className="share-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onClose();
        }
      }}
    >
      <section
        className="share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
      >
        <header className="share-dialog-header">
          <div>
            <h2 id="share-dialog-title">Share board</h2>
            <p>Manage access and invite people to collaborate.</p>
          </div>

          <button
            type="button"
            className="share-dialog-close"
            aria-label="Close sharing dialog"
            disabled={saving}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        {loading ? (
          <div className="share-dialog-loading">
            Loading sharing settings...
          </div>
        ) : (
          <div className="share-dialog-body">
            {error && (
              <div className="share-message share-message-error" role="alert">
                {error}
              </div>
            )}

            {notice && (
              <div
                className="share-message share-message-success"
                role="status"
              >
                {notice}
              </div>
            )}

            <section className="share-section">
              <div className="share-section-heading">
                <div>
                  <h3>General access</h3>
                  <p>Control access through a reusable board link.</p>
                </div>

                <span
                  className={`share-status ${
                    enabled ? "share-status-active" : ""
                  }`}
                >
                  {enabled ? "Active" : "Disabled"}
                </span>
              </div>

              <div className="share-setting">
                <label htmlFor="share-permission">Permission</label>
                <select
                  id="share-permission"
                  value={permission}
                  disabled={saving}
                  onChange={(event) =>
                    setPermission(event.target.value as Permission)
                  }
                >
                  <option value="VIEWER">Viewer — can view</option>
                  <option value="EDITOR">Editor — can edit</option>
                </select>
              </div>

              <div className="share-setting">
                <label htmlFor="share-access-mode">Access method</label>
                <select
                  id="share-access-mode"
                  value={accessMode}
                  disabled={saving}
                  onChange={(event) =>
                    setAccessMode(event.target.value as AccessMode)
                  }
                >
                  <option value="INSTANT">Anyone with the link</option>
                  <option value="APPROVAL">Request creator approval</option>
                </select>
              </div>

              <div className="share-setting">
                <label htmlFor="share-expiry">Expiration (optional)</label>
                <input
                  id="share-expiry"
                  type="datetime-local"
                  value={shareExpiry}
                  disabled={saving}
                  min={toLocalDateTime(new Date().toISOString())}
                  onChange={(event) => setShareExpiry(event.target.value)}
                />
              </div>

              <div className="share-actions">
                {enabled ? (
                  <>
                    <button
                      type="button"
                      className="share-primary-button"
                      disabled={saving}
                      onClick={() => void handleShareLinkSave()}
                    >
                      {saving ? "Saving..." : "Save settings"}
                    </button>

                    <button
                      type="button"
                      className="share-primary-button"
                      disabled={saving}
                      onClick={() => void handleShareLinkSave(true)}
                    >
                      {saving ? "Generating..." : "Generate new link"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="share-primary-button"
                    disabled={saving}
                    onClick={() => void handleShareLinkSave()}
                  >
                    {saving ? "Creating..." : "Create share link"}
                  </button>
                )}

                {enabled && (
                  <button
                    type="button"
                    className="share-danger-button"
                    disabled={saving}
                    onClick={handleShareLinkRevoke}
                  >
                    Disable link
                  </button>
                )}
              </div>

              {enabled && settings && !shareUrl && (
                <p className="share-muted-text">
                  Current link is active. Its original URL cannot be retrieved.
                  Generate a new link to get a copyable URL.
                </p>
              )}

              {shareUrl && (
                <div className="share-generated-link">
                  <input
                    aria-label="Generated reusable link"
                    readOnly
                    value={shareUrl}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <button type="button" onClick={() => void copyLink(shareUrl)}>
                    Copy
                  </button>
                </div>
              )}

              <p className="share-warning">
                Guest access and link validation will become available in the
                next implementation phase. Links generated now are not yet ready
                for guest use.
              </p>
            </section>

            <section className="share-section">
              <div className="share-section-heading">
                <div>
                  <h3>Invite individual people</h3>
                  <p>Create a separate invitation with its own permission.</p>
                </div>
              </div>

              <div className="share-setting">
                <label htmlFor="invite-permission">Permission</label>
                <select
                  id="invite-permission"
                  value={invitePermission}
                  disabled={saving}
                  onChange={(event) =>
                    setInvitePermission(event.target.value as Permission)
                  }
                >
                  <option value="VIEWER">Viewer — can view</option>
                  <option value="EDITOR">Editor — can edit</option>
                </select>
              </div>

              <div className="share-setting">
                <label htmlFor="invite-expiry">Expiration (optional)</label>
                <input
                  id="invite-expiry"
                  type="datetime-local"
                  value={inviteExpiry}
                  disabled={saving}
                  min={toLocalDateTime(new Date().toISOString())}
                  onChange={(event) => setInviteExpiry(event.target.value)}
                />
              </div>

              <button
                type="button"
                className="share-primary-button"
                disabled={saving}
                onClick={handleInvitationCreate}
              >
                {saving ? "Creating..." : "Create invitation link"}
              </button>

              {inviteUrl && (
                <div className="share-generated-link">
                  <input
                    aria-label="Generated invitation link"
                    readOnly
                    value={inviteUrl}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <button
                    type="button"
                    onClick={() => void copyLink(inviteUrl)}
                  >
                    Copy
                  </button>
                </div>
              )}

              {invitations.length > 0 && (
                <div className="share-invitation-list">
                  <h4>Existing invitations</h4>

                  {invitations.map((invitation) => {
                    const revoked = Boolean(invitation.revokedAt);

                    return (
                      <div
                        className="share-invitation-item"
                        key={invitation.id}
                      >
                        <div className="share-invitation-info">
                          <strong>{invitation.permission}</strong>
                          <span>{revoked ? "Revoked" : "Not revoked"}</span>
                          <small>
                            Created {formatDate(invitation.createdAt)}
                          </small>
                          <small>{formatDate(invitation.expiresAt)}</small>
                        </div>

                        {!revoked && (
                          <button
                            type="button"
                            className="share-revoke-button"
                            disabled={saving}
                            onClick={() =>
                              void handleInvitationRevoke(invitation.id)
                            }
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        <footer className="share-dialog-footer">
          <span>Brainstorm Space</span>
          <button
            type="button"
            className="share-footer-close"
            disabled={saving}
            onClick={onClose}
          >
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}
