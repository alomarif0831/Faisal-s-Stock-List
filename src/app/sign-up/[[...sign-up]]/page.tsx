import { SignUp } from "@clerk/nextjs";

export default function Page() {
  return (
    <div className="flex justify-center py-10">
      <SignUp forceRedirectUrl="/account?welcome=1" />
    </div>
  );
}
