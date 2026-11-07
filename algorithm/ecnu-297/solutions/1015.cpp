#include <algorithm>
#include <iostream>
#include <vector>
using namespace std;

struct Task {
    int start, finish;
};

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    if (!(cin >> n)) return 0;
    vector<Task> tasks(n);
    for (Task &task : tasks) cin >> task.start >> task.finish;
    sort(tasks.begin(), tasks.end(), [](const Task &a, const Task &b) {
        return a.finish < b.finish;
    });
    int count = 0, last = 0;
    for (const Task &task : tasks) {
        // 边界相接也算冲突，开始时间必须严格大于上一次结束时间。
        if (task.start > last) {
            ++count;
            last = task.finish;
        }
    }
    cout << count << '\n';
}
