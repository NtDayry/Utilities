import PageMeta from '@/components/common/page/PageMeta';
import AuthLayout from '@/pages/auth/AuthPageLayout';
import SignInForm from '@/components/account/auth/SignInForm';

export default function SignIn() {
  return (
    <>
      <PageMeta title="Login" description="" />
      <AuthLayout>
        <SignInForm />
      </AuthLayout>
    </>
  );
}
