import { useState } from "react";
import type { UserDto } from "@authz-demo/authz-types";
import { Card, CardHead } from "@/components/common";
import { Button } from "@/components/ui/button";
import { useMembershipOp, type MembershipOp } from "@/lib/queries-users";
import { ConfirmDialog, ErrorNote, friendlyError, MembershipBadge, SubmitLabel } from "./shared";

type Status = NonNullable<UserDto["membershipStatus"]>;

const STATUS_TEXT: Record<Status, string> = {
  ACTIVE: "Người dùng đang hoạt động bình thường: nhận role mới và dùng được các quyền của mình.",
  SUSPENDED: "Mọi quyền của người dùng đang mất hiệu lực. Các role vẫn được giữ lại và có hiệu lực trở lại khi khôi phục.",
  REMOVED: "Người dùng đã bị loại bỏ khỏi tenant. Mọi role trước đó đã bị thu hồi vĩnh viễn.",
};

type OpInfo = {
  op: MembershipOp;
  label: string;
  hint: string;
  danger: boolean;
  confirm?: { title: string; body: string; button: string };
};

const OPS: Record<Status, OpInfo[]> = {
  ACTIVE: [
    {
      op: "suspend",
      label: "Tạm ngưng",
      hint: "Quyền mất hiệu lực ngay nhưng các role vẫn được giữ lại.",
      danger: false,
      confirm: {
        title: "Tạm ngưng người dùng này?",
        body: "Mọi quyền của người dùng mất hiệu lực ngay lập tức, nhưng các role vẫn được giữ lại. Khôi phục sau sẽ có hiệu lực trở lại.",
        button: "Tạm ngưng",
      },
    },
    {
      op: "remove",
      label: "Loại bỏ",
      hint: "Thu hồi vĩnh viễn mọi role và loại người dùng khỏi tenant.",
      danger: true,
      confirm: {
        title: "Loại bỏ người dùng này?",
        body: "Mọi role của người dùng sẽ bị thu hồi vĩnh viễn và không khôi phục lại được. Nếu thêm lại sau này, người dùng bắt đầu từ đầu và không có role nào.",
        button: "Loại bỏ người dùng",
      },
    },
  ],
  SUSPENDED: [
    { op: "restore", label: "Khôi phục", hint: "Các role đang giữ có hiệu lực trở lại.", danger: false },
    {
      op: "remove",
      label: "Loại bỏ",
      hint: "Thu hồi vĩnh viễn mọi role và loại người dùng khỏi tenant.",
      danger: true,
      confirm: {
        title: "Loại bỏ người dùng này?",
        body: "Mọi role của người dùng sẽ bị thu hồi vĩnh viễn và không khôi phục lại được. Nếu thêm lại sau này, người dùng bắt đầu từ đầu và không có role nào.",
        button: "Loại bỏ người dùng",
      },
    },
  ],
  REMOVED: [{ op: "readd", label: "Thêm lại", hint: "Đưa người dùng trở lại tenant, chưa có role nào.", danger: false }],
};

export function MembershipTab({ user }: { user: UserDto }) {
  const canManage = user._actions.includes("membership");
  const mutation = useMembershipOp(user.id);
  const [confirming, setConfirming] = useState<OpInfo | null>(null);
  const status = user.membershipStatus;
  const ops = canManage && status ? OPS[status] : [];

  const errorText = mutation.isError
    ? friendlyError(mutation.error, {
        forbidden:
          "Bạn không thực hiện được thao tác này. Bạn không tạm ngưng hoặc loại bỏ được người cùng cấp hoặc cao cấp hơn mình, và quản trị hệ thống được bảo vệ.",
        conflict: "Trạng thái hiện tại không cho phép thao tác này (có thể đã được người khác đổi). Dữ liệu đã được tải lại.",
      })
    : null;

  const run = (info: OpInfo, onDone?: () => void) => mutation.mutate(info.op, { onSuccess: onDone });

  return (
    <Card>
      <CardHead title="Tư cách thành viên" meta={<MembershipBadge status={status} />} />
      <div className="border-t border-border-strong px-4 py-4 text-sm sm:px-5">
        <p className="text-muted">{status ? STATUS_TEXT[status] : "Người dùng chưa có tư cách thành viên trong tenant này."}</p>
        {canManage && ops.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-3">
            {ops.map((info) => (
              <li key={info.op} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-strong px-4 py-3">
                <p className="min-w-0 flex-1 text-sm text-muted">
                  <span className="block font-medium text-foreground">{info.label}</span>
                  {info.hint}
                </p>
                <Button
                  variant={info.danger ? "danger" : "outline"}
                  disabled={mutation.isPending}
                  aria-busy={(mutation.isPending && mutation.variables === info.op) || undefined}
                  onClick={() => {
                    mutation.reset();
                    if (info.confirm) setConfirming(info);
                    else run(info);
                  }}
                >
                  <SubmitLabel pending={mutation.isPending && mutation.variables === info.op && !info.confirm}>{info.label}</SubmitLabel>
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {!canManage ? <p className="mt-4 text-xs text-muted">Bạn không có quyền thay đổi tư cách thành viên.</p> : null}
        {!confirming ? <ErrorNote message={errorText} className="mt-4" /> : null}
      </div>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={confirming?.confirm?.title ?? ""}
        description={<p>{confirming?.confirm?.body}</p>}
        confirmLabel={confirming?.confirm?.button ?? ""}
        danger={confirming?.danger ?? true}
        pending={mutation.isPending}
        error={errorText}
        onConfirm={() => confirming && run(confirming, () => setConfirming(null))}
      />
    </Card>
  );
}
