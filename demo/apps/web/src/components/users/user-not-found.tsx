import { Link } from "@tanstack/react-router";
import { ErrorScreen } from "@/components/error-screen";
import { buttonClasses } from "@/components/ui/button";

export function UserNotFoundScreen() {
  return (
    <ErrorScreen
      code="404"
      title="Không tìm thấy người dùng"
      description="Người dùng không tồn tại, hoặc nằm ngoài phạm vi bạn được xem."
      primary={
        <Link to="/nguoi-dung" search={{}} className={buttonClasses("primary", "min-h-11 md:min-h-10")}>
          Về danh sách người dùng
        </Link>
      }
      footCode="404 · not_found"
    />
  );
}
