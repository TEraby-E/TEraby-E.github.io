#include <algorithm>
#include <cmath>
#include <iomanip>
#include <iostream>
#include <limits>
#include <vector>
using namespace std;

struct Point {
    double x, y;
};

vector<Point> point, buffer;

bool byY(const Point &a, const Point &b) {
    return a.y < b.y;
}

double distanceSquared(const Point &a, const Point &b) {
    double dx = a.x - b.x;
    double dy = a.y - b.y;
    return dx * dx + dy * dy;
}

// 输入段按 x 有序，返回最短距离的平方，并将该段改为按 y 有序。
double closest(int left, int right) {
    if (right - left <= 3) {
        double best = numeric_limits<double>::infinity();
        for (int i = left; i < right; ++i)
            for (int j = i + 1; j < right; ++j)
                best = min(best, distanceSquared(point[i], point[j]));
        sort(point.begin() + left, point.begin() + right, byY);
        return best;
    }

    int middle = (left + right) / 2;
    double middleX = point[middle].x;
    double best = min(closest(left, middle), closest(middle, right));
    merge(point.begin() + left, point.begin() + middle,
          point.begin() + middle, point.begin() + right, buffer.begin() + left, byY);
    copy(buffer.begin() + left, buffer.begin() + right, point.begin() + left);

    // 只比较分界线两侧的窄条。按 y 枚举时，每点只需检查常数个邻点。
    int count = left;
    for (int i = left; i < right; ++i) {
        double dx = point[i].x - middleX;
        if (dx * dx >= best) continue;
        for (int j = count - 1; j >= left; --j) {
            double dy = point[i].y - buffer[j].y;
            if (dy * dy >= best) break;
            best = min(best, distanceSquared(point[i], buffer[j]));
        }
        buffer[count++] = point[i];
    }
    return best;
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    while (cin >> n && n) {
        point.resize(n);
        buffer.resize(n);
        for (Point &p : point) cin >> p.x >> p.y;
        sort(point.begin(), point.end(),
             [](const Point &a, const Point &b) { return a.x < b.x; });
        cout << fixed << setprecision(2) << sqrt(closest(0, n)) / 2 << '\n';
    }
    return 0;
}
