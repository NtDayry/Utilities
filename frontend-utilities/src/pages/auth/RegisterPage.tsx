import { useTranslation } from 'react-i18next';
import PageMeta from '@/components/common/page/PageMeta';
import AuthLayout from '@/pages/auth/AuthPageLayout';
import SignUpForm from '@/components/account/auth/SignUpForm';

export default function SignUp() {
  const { t } = useTranslation();
  return (
    <>
      <PageMeta title={t('page.register.meta_title')} description={t('page.register.meta_description')} />
      <AuthLayout>
        <SignUpForm />
      </AuthLayout>
    </>
  );
}
