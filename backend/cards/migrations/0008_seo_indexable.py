from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('cards', '0007_language'),
    ]

    operations = [
        migrations.AddField(
            model_name='card',
            name='seo_indexable',
            field=models.BooleanField(default=False),
        ),
    ]
